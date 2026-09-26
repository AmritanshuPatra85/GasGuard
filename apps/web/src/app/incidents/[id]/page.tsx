import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/gasguard/app-shell";
import { SectionHeader } from "@/components/gasguard/section-header";
import { formatDistanceToNow, formatDistance } from "date-fns";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function IncidentDetailPage({ params }: PageProps) {
  const supabase = await createClient();
  const { id: incidentId } = await params;

  const { data: incident, error } = await supabase
    .from("incidents")
    .select(
      `
      id,
      severity,
      state,
      started_at,
      resolved_at,
      devices (
        id,
        device_key,
        flats ( id, number, towers ( id, name ) )
      )
    `,
    )
    .eq("id", incidentId)
    .single();

  if (error || !incident) {
    notFound();
  }

  const { data: events } = await supabase
    .from("incident_events")
    .select("event_type, actor, payload, created_at")
    .eq("incident_id", incidentId)
    .order("created_at", { ascending: true });

  const device = incident.devices;
  const flat = device?.flats;
  const tower = flat?.towers;

  const duration = incident.resolved_at
    ? formatDistance(new Date(incident.started_at), new Date(incident.resolved_at))
    : formatDistanceToNow(new Date(incident.started_at));

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between">
          <SectionHeader
            title={`${incident.severity} incident`}
            description={
              tower && flat && device
                ? `${tower.name} \u00b7 Flat ${flat.number} \u00b7 ${device.device_key}`
                : "Unassigned device"
            }
          />
          <SeverityPill severity={incident.severity} state={incident.state} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard
            label="Started"
            value={formatDistanceToNow(new Date(incident.started_at), { addSuffix: true })}
          />
          <MetricCard label="Duration" value={duration} />
          <MetricCard label="State" value={incident.state} />
        </div>

        {device && (
          <Link
            href={`/devices/${device.id}`}
            className="w-fit rounded-md border border-border bg-surface px-4 py-2 text-sm text-foreground hover:border-border/50"
          >
            Open device →
          </Link>
        )}

        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">
            Incident timeline
          </h2>
          {events && events.length > 0 ? (
            <ol className="flex flex-col gap-4">
              {events.map((event, i) => {
                const payload = event.payload as {
                  to?: string;
                  from?: string;
                  reasons?: string[];
                } | null;
                return (
                  <li key={i} className="border-l-2 border-border pl-4">
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
                      {" \u00b7 "}
                      {event.actor}
                    </p>
                    <p className="text-sm text-foreground">
                      {event.event_type === "severity_changed" && payload?.from && payload?.to
                        ? `Severity changed: ${payload.from} \u2192 ${payload.to}`
                        : event.event_type}
                    </p>
                    {payload?.reasons && payload.reasons.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                        {payload.reasons.map((reason, j) => (
                          <li key={j}>{reason}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No timeline events recorded.
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

function SeverityPill({ severity, state }: { severity: string; state: string }) {
  const styles: Record<string, string> = {
    warning: "bg-status-warning/15 text-status-warning border-status-warning/40",
    critical: "bg-status-critical/15 text-status-critical border-status-critical/40",
  };
  const style = styles[severity] ?? "bg-muted/15 text-muted-foreground border-border";
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide ${style}`}>
      {severity} {"\u00b7"} {state}
    </span>
  );
}
