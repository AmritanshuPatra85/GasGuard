import { supabase } from "./db";

export type DeviceHealth = "unknown" | "ok" | "warning" | "critical" | "offline";

export async function updateDeviceState(params: {
  deviceId: string;
  lastSeen: string;
  currentGas: number | null;
  health: DeviceHealth;
}): Promise<void> {
  const { error } = await supabase.from("device_state").upsert(
    {
      device_id: params.deviceId,
      last_seen: params.lastSeen,
      current_gas: params.currentGas,
      health: params.health,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "device_id" },
  );

  if (error) {
    throw error;
  }
}