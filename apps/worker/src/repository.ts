import { supabase } from "./db";
import { incrementMetric } from "./metrics";
import type { DeviceHealth } from "./state";

// -- device_key -> devices.id cache ---------------------------------------

const deviceIdCache = new Map<string, string>();
let preloadPromise: Promise<void> | null = null;

async function preloadDeviceCache(): Promise<void> {
  const pageSize = 1000; // PostgREST caps a single response at 1000 rows
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("devices")
      .select("id, device_key")
      .range(from, from + pageSize - 1);
    if (error) {
      throw new Error(`device preload failed: ${error.message}`);
    }
    for (const row of data ?? []) {
      deviceIdCache.set(row.device_key, row.id);
    }
    if (!data || data.length < pageSize) break;
  }
}

/**
 * Resolves an MQTT device key (e.g. "esp-0001") to devices.id.
 * The first call loads every device in one query, so 500 devices
 * connecting at once do not cause 500 lookups.
 * Returns null if the device does not exist.
 */
export async function findDeviceIdByKey(deviceKey: string): Promise<string | null> {
  const cached = deviceIdCache.get(deviceKey);
  if (cached) return cached;

  if (!preloadPromise) {
    preloadPromise = preloadDeviceCache().catch((err) => {
      preloadPromise = null; // allow a retry on the next message
      throw err;
    });
  }
  await preloadPromise;

  const afterPreload = deviceIdCache.get(deviceKey);
  if (afterPreload) return afterPreload;

  // Device seeded after the preload: fall back to a single lookup.
  const { data, error } = await supabase
    .from("devices")
    .select("id")
    .eq("device_key", deviceKey)
    .maybeSingle();

  if (error) {
    throw new Error(`device lookup failed: ${error.message}`);
  }
  if (!data) return null;

  deviceIdCache.set(deviceKey, data.id);
  return data.id;
}

// -- Batched reading writer ------------------------------------------------

export interface QueuedReading {
  deviceId: string; // devices.id (UUID), not device_key
  recordedAt: string; // ISO timestamp
  sequence: number;
  gasRaw: number;
  gasValue: number;
  temperature: number | null;
  humidity: number | null;
  health: DeviceHealth; // from the detector: ok / warning / critical
}

const FLUSH_INTERVAL_MS = 1_000;
const STATS_INTERVAL_MS = 10_000;
const MAX_BATCH = 500;

const queue: QueuedReading[] = [];
let flushing = false;
let stats = { inserted: 0, duplicates: 0, failed: 0 };

function describe(error: { message: string; code?: string; details?: string; hint?: string }) {
  return [error.message, error.code && `code=${error.code}`, error.details, error.hint]
    .filter(Boolean)
    .join(" | ");
}

async function writeBatch(batch: QueuedReading[]): Promise<void> {
  const rows = batch.map((r) => ({
    device_id: r.deviceId,
    recorded_at: r.recordedAt,
    sequence: r.sequence,
    gas_raw: r.gasRaw,
    gas_value: r.gasValue,
    temperature: r.temperature,
    humidity: r.humidity,
  }));

  // ON CONFLICT (device_id, sequence) DO NOTHING; returns only the inserted rows.
  const { data, error } = await supabase
    .from("readings")
    .upsert(rows, { onConflict: "device_id,sequence", ignoreDuplicates: true })
    .select("device_id");

  if (error) {
    incrementMetric("databaseErrors");
    stats.failed += batch.length;
    console.error(`[worker] Batch insert failed (${batch.length} readings dropped): ${describe(error)}`);
    return;
  }

  const inserted = data?.length ?? 0;
  const duplicates = batch.length - inserted;
  for (let i = 0; i < inserted; i++) incrementMetric("accepted");
  for (let i = 0; i < duplicates; i++) {
    incrementMetric("duplicate");
    incrementMetric("rejected");
  }
  stats.inserted += inserted;
  stats.duplicates += duplicates;

  // Latest snapshot per device, one upsert for the whole batch.
  const latest = new Map<string, QueuedReading>();
  for (const r of batch) {
    const prev = latest.get(r.deviceId);
    if (!prev || r.recordedAt >= prev.recordedAt) latest.set(r.deviceId, r);
  }
  const now = new Date().toISOString();
  const stateRows = [...latest.values()].map((r) => ({
    device_id: r.deviceId,
    last_seen: r.recordedAt,
    current_gas: r.gasValue,
    health: r.health,
    updated_at: now,
  }));

  const { error: stateError } = await supabase
    .from("device_state")
    .upsert(stateRows, { onConflict: "device_id" });

  if (stateError) {
    incrementMetric("databaseErrors");
    console.error(`[worker] device_state upsert failed: ${describe(stateError)}`);
  }
}

export async function flushReadings(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  try {
    while (queue.length > 0) {
      await writeBatch(queue.splice(0, MAX_BATCH));
    }
  } catch (err) {
    incrementMetric("databaseErrors");
    console.error("[worker] Flush error:", err instanceof Error ? err.message : String(err));
  } finally {
    flushing = false;
  }
}

export function enqueueReading(reading: QueuedReading): void {
  queue.push(reading);
  if (queue.length >= MAX_BATCH) void flushReadings();
}

let started = false;

export function startReadingWriter(): void {
  if (started) return;
  started = true;

  setInterval(() => void flushReadings(), FLUSH_INTERVAL_MS);

  setInterval(() => {
    const { inserted, duplicates, failed } = stats;
    if (inserted + duplicates + failed > 0) {
      console.log(
        `[worker] last ${STATS_INTERVAL_MS / 1000}s: inserted=${inserted} duplicates=${duplicates} failed=${failed} queued=${queue.length}`,
      );
    }
    stats = { inserted: 0, duplicates: 0, failed: 0 };
  }, STATS_INTERVAL_MS);
}