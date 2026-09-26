import type { SupabaseClient } from "@supabase/supabase-js";

export async function getTriggerGasValue(
  supabase: SupabaseClient,
  deviceId: string,
  startedAt: string,
): Promise<number> {
  const { data: before } = await supabase
    .from("readings")
    .select("gas_value")
    .eq("device_id", deviceId)
    .lte("recorded_at", startedAt)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (before?.gas_value != null) return before.gas_value;

  const { data: after } = await supabase
    .from("readings")
    .select("gas_value")
    .eq("device_id", deviceId)
    .gte("recorded_at", startedAt)
    .order("recorded_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return after?.gas_value ?? 0;
}
