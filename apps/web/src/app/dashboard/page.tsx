import Link from "next/link";
import { AppShell } from "@/components/gasguard/app-shell";
import { SectionHeader } from "@/components/gasguard/section-header";
import { MetricCard } from "@/components/gasguard/metric-card";
import { DeviceCard } from "@/components/gasguard/device-card";
import { IncidentCard } from "@/components/gasguard/incident-card";
import { createClient } from "@/lib/supabase/server";
import { getTriggerGasValue } from "@/lib/gasguard/get-trigger-gas-value";

export const dynamic = "force-dynamic";

type DeviceStatus = "healthy" | "warning" | "critical" | "offline";

function mapHealth(health: string | null): DeviceStatus {
  if (health === "ok") return "healthy";
  if (health === "warning" || health === "critical" || health === "offline") return health;
  return "offline";
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: stateRows } = await supabase
    .from("device_state")
    .select(
      `
      device_id,
      last_seen,
      current_gas,
      health,
      devices ( id, device_key, flats ( number, towers ( name ) ) )
    `,
    );

  const devices = (stateRows ?? []).map((row) => {
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

  const onlineCount = devices.filter((d) => d.status !== "offline").length;
  const offlineCount = devices.filter((d) => d.status === "offline").length;
  const warningCount = devices.filter((d) => d.status === "warning").length;

  const { data: incidentRows } = await supabase
    .from("incidents")
    .select(
      `
      id,
      severity,
      started_at,
      device_id,
      devices ( device_key, flats ( number, towers ( name ) ) )
    `,
    )
    .is("resolved_at", null)
    .order("started_at", { ascending: false });

  const activeIncidentCount = incidentRows?.length ?? 0;

  const recentIncidents = await Promise.all(
    (incidentRows ?? []).slice(0, 3).map(async (row) => {
      const device = row.devices;
      const flat = device?.flats;
      const tower = flat?.towers;

      return {
        incidentId: row.id,
        locationLabel:
          tower && flat ? `${tower.name} \u00b7 Flat ${flat.number}` : (device?.device_key ?? "Unknown"),
        severity: row.severity as "warning" | "critical",
        triggerGasValue: await getTriggerGasValue(supabase, row.device_id, row.started_at),
        startedAt: row.started_at,
        acknowledged: false,
      };
    }),
  );

  const attentionDevices = devices.filter((d) => d.status !== "healthy").slice(0, 6);

  return (
    <AppShell>
      <div className="flex flex-col gap-10">
        <SectionHeader
          title="Dashboard"
          description="Overview of all monitored devices."
        />

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard label="Online Devices" value={onlineCount} />
          <MetricCard label="Active Incidents" value={activeIncidentCount} tone="critical" />
          <MetricCard label="Warnings" value={warningCount} tone="warning" />
          <MetricCard label="Offline" value={offlineCount} />
        </div>

        <div className="flex flex-col gap-4">
          <SectionHeader
            title="Recent Incidents"
            description="Most recent active incidents."
            action={
              <Link href="/incidents" className="text-sm text-primary hover:underline">
                View all
              </Link>
            }
          />
          {recentIncidents.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {recentIncidents.map((i) => (
                <IncidentCard key={i.incidentId} {...i} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No active incidents.</p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <SectionHeader
            title="Devices Needing Attention"
            description="Devices reporting warnings, critical readings, or offline status."
            action={
              <Link href="/devices" className="text-sm text-primary hover:underline">
                View all
              </Link>
            }
          />
          {attentionDevices.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {attentionDevices.map((d) => (
                <DeviceCard key={d.deviceId} {...d} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">All devices are healthy.</p>
          )}
        </div>
      </div>
    </AppShell>
  );
}
