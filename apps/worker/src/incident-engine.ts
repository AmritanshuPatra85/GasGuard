import { supabase } from "./db";
import { incrementMetric } from "./metrics";
import {
  createInitialState,
  detect,
  type DetectorResult,
  type DetectorState,
  type IncidentLevel,
  type LevelTransition,
  type SensorEvent,
} from "./detector";
import type { DeviceHealth } from "./state";

/**
 * Runs the pure detector for every device and persists what it decides.
 *
 *   processReading()  synchronous: detect(), update in-memory state, return health.
 *   DB writes         asynchronous, serialised PER DEVICE so "open" always lands
 *                     before "escalate" before "resolve".
 *
 * Detector state lives in memory. After a worker restart a device re-warms its
 * baseline, and any incident still open in the database is adopted (not duplicated).
 */

type IncidentSeverity = "suspicious" | "warning" | "critical";
type Payload = { [key: string]: string | number | boolean | null | string[] };

const SEVERITY: Record<Exclude<IncidentLevel, "NORMAL">, IncidentSeverity> = {
  SUSPICIOUS: "suspicious",
  WARNING: "warning",
  CRITICAL: "critical",
};

const HEALTH: Record<IncidentLevel, DeviceHealth> = {
  NORMAL: "ok",
  SUSPICIOUS: "warning",
  WARNING: "warning",
  CRITICAL: "critical",
};

const detectors = new Map<string, DetectorState>(); // devices.id -> detector state
const openIncidents = new Map<string, string>(); // devices.id -> incidents.id
const chains = new Map<string, Promise<void>>(); // devices.id -> tail of its DB work

let ready: Promise<void> = Promise.resolve();

/** Call once at startup, before messages are handled. */
export function startIncidentEngine(): void {
  ready = loadOpenIncidents();
}

async function loadOpenIncidents(): Promise<void> {
  const { data, error } = await supabase.from("incidents").select("id, device_id").neq("state", "resolved");
  if (error) {
    incrementMetric("databaseErrors");
    console.error(`[incidents] Could not load open incidents: ${error.message}`);
    return;
  }
  for (const row of data ?? []) openIncidents.set(row.device_id, row.id);
  console.log(`[incidents] Adopted ${data?.length ?? 0} open incident(s) from the database`);
}

/** Resolves when all queued incident writes have finished (used on shutdown and in tests). */
export async function drainIncidentWork(): Promise<void> {
  await Promise.all([...chains.values()]);
}

export interface IncidentReadingInput {
  deviceId: string; // devices.id (UUID)
  deviceKey: string; // e.g. "ESP-0001", for logs
  timestampMs: number;
  value: number; // gas.value
}

/** Feed one accepted reading. Returns the device health to store in device_state. */
export function processReading(input: IncidentReadingInput): DeviceHealth {
  const prev = detectors.get(input.deviceId) ?? createInitialState();
  const result = detect(prev, { timestampMs: input.timestampMs, value: input.value });
  detectors.set(input.deviceId, result.state);

  const recordedAt = new Date(input.timestampMs).toISOString();

  // Sensor event first: if the same reading also cancels the incident, the event must land on it before it closes.
  if (result.sensorEvent) {
    const event = result.sensorEvent;
    console.warn(`[incidents] ${input.deviceKey} sensor fault ${event}: ${result.reasons.join("; ")}`);
    enqueue(input.deviceId, () => recordSensorEvent(input.deviceId, recordedAt, event, result));
  }

  if (result.transition) {
    const transition = result.transition;
    console.log(
      `[incidents] ${input.deviceKey} ${transition.from} -> ${transition.to}: ${result.reasons.join("; ")}`,
    );
    enqueue(input.deviceId, () => applyTransition(input.deviceId, recordedAt, transition, result));
  }

  return HEALTH[result.state.level];
}

// -- serialised per-device DB work ----------------------------------------

function enqueue(deviceId: string, work: () => Promise<void>): void {
  const tail = chains.get(deviceId) ?? Promise.resolve();
  const next = tail
    .then(async () => {
      await ready;
      await work();
    })
    .catch((err) => {
      incrementMetric("databaseErrors");
      console.error(
        `[incidents] DB write failed for device ${deviceId}:`,
        err instanceof Error ? err.message : JSON.stringify(err),
      );
    });
  chains.set(deviceId, next);
  void next.finally(() => {
    if (chains.get(deviceId) === next) chains.delete(deviceId);
  });
}

function payloadOf(result: DetectorResult, extra: Payload = {}): Payload {
  return {
    ...extra,
    reasons: [...result.reasons],
    zScore: result.zScore,
    relativeDeviation: result.relativeDeviation,
    ratePerMin: result.ratePerMin,
  };
}

async function insertEvent(incidentId: string, eventType: string, payload: Payload, at: string): Promise<void> {
  await supabase
    .from("incident_events")
    .insert({ incident_id: incidentId, event_type: eventType, actor: "detector", payload, created_at: at })
    .throwOnError();
}

async function setSeverity(incidentId: string, severity: IncidentSeverity): Promise<void> {
  await supabase.from("incidents").update({ severity }).eq("id", incidentId).throwOnError();
}

async function applyTransition(
  deviceId: string,
  at: string,
  transition: LevelTransition,
  result: DetectorResult,
): Promise<void> {
  const incidentId = openIncidents.get(deviceId);

  // Incident ends: recovered, or cancelled because the sensor is faulty.
  if (transition.to === "RESOLVED" || transition.to === "SENSOR_FAULT") {
    if (!incidentId) return;
    await supabase
      .from("incidents")
      .update({ state: "resolved", resolved_at: at })
      .eq("id", incidentId)
      .throwOnError();
    openIncidents.delete(deviceId);
    await insertEvent(
      incidentId,
      transition.to === "RESOLVED" ? "resolved" : "cancelled_sensor_fault",
      payloadOf(result, { from: transition.from, to: transition.to }),
      at,
    );
    return;
  }

  // Level went up. The detector never reports a move to NORMAL (it reports RESOLVED instead).
  if (transition.to === "NORMAL") return;
  const severity = SEVERITY[transition.to];
  const eventPayload = payloadOf(result, { from: transition.from, to: transition.to });

  if (incidentId) {
    await setSeverity(incidentId, severity);
    await insertEvent(incidentId, "severity_changed", eventPayload, at);
    return;
  }

  const { data, error } = await supabase
    .from("incidents")
    .insert({ device_id: deviceId, severity, state: "open", started_at: at })
    .select("id")
    .single();

  if (error) {
    // 23505: the partial unique index says an open incident already exists. Adopt it.
    if (error.code === "23505") {
      const { data: existing } = await supabase
        .from("incidents")
        .select("id")
        .eq("device_id", deviceId)
        .neq("state", "resolved")
        .maybeSingle()
        .throwOnError();
      if (existing) {
        openIncidents.set(deviceId, existing.id);
        await setSeverity(existing.id, severity);
        await insertEvent(existing.id, "severity_changed", eventPayload, at);
        return;
      }
    }
    throw error;
  }

  openIncidents.set(deviceId, data.id);
  await insertEvent(data.id, "opened", eventPayload, at);
}

async function recordSensorEvent(
  deviceId: string,
  at: string,
  event: SensorEvent,
  result: DetectorResult,
): Promise<void> {
  const incidentId = openIncidents.get(deviceId);
  if (!incidentId) return; // no incident to attach to; the console log above is the record
  await insertEvent(
    incidentId,
    event === "FAULT_STARTED" ? "sensor_fault_started" : "sensor_fault_cleared",
    payloadOf(result, { fault: result.state.sensorFault }),
    at,
  );
}