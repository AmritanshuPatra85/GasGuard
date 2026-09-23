import { supabase } from "./db";

export const OFFLINE_TIMEOUT_MS = 15_000;

export async function markOfflineDevices(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - OFFLINE_TIMEOUT_MS).toISOString();

  const { data, error } = await supabase
    .from("device_state")
    .update({
      health: "offline",
      updated_at: now.toISOString(),
    })
    .not("last_seen", "is", null)
    .lt("last_seen", cutoff)
    .neq("health", "offline")
    .select("device_id");

  if (error) {
    throw error;
  }

  return data?.length ?? 0;
}