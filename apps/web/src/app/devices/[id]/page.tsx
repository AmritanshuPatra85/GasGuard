import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/gasguard/app-shell";
import { SectionHeader } from "@/components/gasguard/section-header";
import { DeviceChart } from "./device-chart";
import { formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DeviceDetailPage({ params }: PageProps) {
  const supabase = await createClient();
  const { id: deviceId } = await params;

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select(
      `
      id,
      device_key,
      status,
      firmware_version,
      flats (
        id,
        number,
        floor,
        towers ( id, name )
      )
    `,
    )
    .eq("id", deviceId)
    .single();

  if (deviceError || !device) {
    notFound();
  }

  const { data: state } = await supabase
    .from("device_state")
    .select("last_seen, current_gas, health")
    .eq("device_id", deviceId)
    .maybeSingle();

  const { data: openIncident } = await supabase
    .from("incidents")
    .select("id, severity, started_at")
    .eq("device_id", deviceId)
    .is("resolved_at", null)
    .maybeSingle();

  const { data: readingsDesc } = await supabase
    .from("readings")
    .select("recorded_at, gas_value, temperature, humidity")
    .eq("device_id", deviceId)
    .order("recorded_at", { ascending: false })
    .limit(500);

  const readings = (readingsDesc ?? []).slice().reverse();

  const flat = device.flats;
  const tower = flat?.towers;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between">
          <SectionHeader
            title={device.device_key}
            description={
              tower && flat ? `${tower.name} \u00b7 Flat ${flat.number}` : "Unassigned"
            }
          />
          <StatusPill status={state?.health ?? "unknown"} />
        </div>

        {openIncident ? (
          <Link href={`/incidents/${openIncident.id}`} className="rounded-lg border border-status-critical/40 bg-status-critical/10 px-4 py-3 text-sm text-status-critical hover:bg-status-critical/15">
            Open {openIncident.severity} incident since{" "}
            {formatDistanceToNow(new Date(openIncident.started_at), { addSuffix: true })} - view details
          </Link>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard
            label="Gas value"
            value={state?.current_gas != null ? state.current_gas.toFixed(1) : "-"}
          />
          <MetricCard
            label="Last seen"
            value={
              state?.last_seen
                ? formatDistanceToNow(new Date(state.last_seen), { addSuffix: true })
                : "Never"
            }
          />
          <MetricCard label="Firmware" value={device.firmware_version ?? "-"} />
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">
            Recent gas readings
          </h2>
          {readings.length > 0 ? (
            <DeviceChart readings={readings} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No readings yet for this device.
            </p>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    healthy: "bg-status-healthy/15 text-status-healthy border-status-healthy/40",
    warning: "bg-status-warning/15 text-status-warning border-status-warning/40",
    critical: "bg-status-critical/15 text-status-critical border-status-critical/40",
    offline: "bg-status-offline/15 text-status-offline border-status-offline/40",
  };
  const style = styles[status] ?? "bg-muted/15 text-muted-foreground border-border";
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide ${style}`}>
      {status}
    </span>
  );
}
