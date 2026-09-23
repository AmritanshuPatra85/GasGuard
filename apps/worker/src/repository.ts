import { supabase } from "./db";

// Postgres unique_violation. Supabase surfaces it as error.code.
const PG_UNIQUE_VIOLATION = "23505";

// device_key -> devices.id (UUID). Only hits are cached, so a device
// seeded after the worker started still resolves on its next message.
const deviceIdCache = new Map<string, string>();

export interface InsertReadingParams {
  deviceId: string; // devices.id (UUID), not device_key
  recordedAt: string; // ISO timestamp
  sequence: number;
  gasRaw: number;
  gasValue: number;
  temperature: number | null;
  humidity: number | null;
}

export type InsertReadingResult = "inserted" | "duplicate";

/**
 * Resolves an MQTT device key (e.g. "esp-0001") to devices.id.
 * Returns null if the device does not exist.
 * Throws on a real database error, so "not found" and "query failed"
 * stay distinguishable for the metrics.
 */
export async function findDeviceIdByKey(deviceKey: string): Promise<string | null> {
  const cached = deviceIdCache.get(deviceKey);
  if (cached) return cached;

  const { data, error } = await supabase
    .from("devices")
    .select("id")
    .eq("device_key", deviceKey)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  deviceIdCache.set(deviceKey, data.id);
  return data.id;
}

/**
 * Inserts one telemetry reading.
 * Returns "duplicate" when UNIQUE(device_id, sequence) rejects it,
 * which is expected after a worker restart, so it is not an error.
 * Throws on any other database error.
 */
export async function insertReading(
  params: InsertReadingParams,
): Promise<InsertReadingResult> {
  const { error } = await supabase.from("readings").insert({
    device_id: params.deviceId,
    recorded_at: params.recordedAt,
    sequence: params.sequence,
    gas_raw: params.gasRaw,
    gas_value: params.gasValue,
    temperature: params.temperature,
    humidity: params.humidity,
  });

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return "duplicate";
    }
    throw error;
  }

  return "inserted";
}