import { supabase } from "./db";

const PG_UNIQUE_VIOLATION = "23505";

/**
 * Records that a device is alive by refreshing device_state.last_seen.
 *
 * It deliberately does NOT touch health or current_gas. Those belong to
 * telemetry (and later, incident logic).
 *
 * It updates first rather than upserting. An upsert would need to supply
 * every NOT NULL column (such as health) for the insert path, and would
 * risk overwriting existing values on conflict.
 */
export async function updateDeviceHeartbeat(params: {
  deviceId: string;
  lastSeen: string;
}): Promise<void> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("device_state")
    .update({ last_seen: params.lastSeen, updated_at: now })
    .eq("device_id", params.deviceId)
    .select("device_id");

  if (error) {
    throw error;
  }

  if (data && data.length > 0) {
    return;
  }

  // No device_state row yet (heartbeat arrived before first telemetry).
  const { error: insertError } = await supabase.from("device_state").insert({
    device_id: params.deviceId,
    last_seen: params.lastSeen,
    health: "unknown",
    updated_at: now,
  });

  // A concurrent telemetry upsert may have created the row between our
  // update and insert. That is fine; the row exists and last_seen is set.
  if (insertError && insertError.code !== PG_UNIQUE_VIOLATION) {
    throw insertError;
  }
}