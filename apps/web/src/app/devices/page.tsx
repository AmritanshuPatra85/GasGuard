import { AppShell } from "@/components/gasguard/app-shell";
import { SectionHeader } from "@/components/gasguard/section-header";
import { DeviceCard } from "@/components/gasguard/device-card";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type DeviceStatus = "healthy" | "warning" | "critical" | "offline";

function mapHealth(health: string | null): DeviceStatus {
  if (health === "ok") return "healthy";
  if (health === "warning" || health === "critical" || health === "offline") return health;
  // Unknown/unset health falls back to offline rather than a fake "healthy".
  return "offline";
}

export default async function DevicesPage() {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("device_state")
    .select(
      `
      device_id,
      last_seen,
      current_gas,
      health,
      devices ( id, device_key, flats ( number, towers ( name ) ) )
    `,
    )
    .order("last_seen", { ascending: false, nullsFirst: false });

  const devices = (rows ?? []).map((row) => {
    const device = row.devices;
    const flat = device?.flats;
    const tower = flat?.towers;

    return {
      deviceId: device?.id ?? row.device_id,
      locationLabel:
        tower && flat ? `${tower.name} \u00b7 Flat ${flat.number}` : (device?.device_key ?? "Unknown"),
      status: mapHealth(row.health),
      latestGasValue: row.current_gas ?? 0,
      lastSeenAt: row.last_seen ?? new Date(0).toISOString(),
    };
  });

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <SectionHeader
          title="Devices"
          description="All monitored devices across the fleet."
        />

        {devices.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {devices.map((d) => (
              <DeviceCard key={d.deviceId} {...d} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No devices found.</p>
        )}
      </div>
    </AppShell>
  );
}
