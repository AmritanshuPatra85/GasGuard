import { AppShell } from "@/components/gasguard/app-shell";
import { SectionHeader } from "@/components/gasguard/section-header";
import { IncidentCard } from "@/components/gasguard/incident-card";
import { createClient } from "@/lib/supabase/server";
import { getTriggerGasValue } from "@/lib/gasguard/get-trigger-gas-value";

export const dynamic = "force-dynamic";

export default async function IncidentsPage() {
  const supabase = await createClient();

  const { data: rows } = await supabase
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

  const incidents = await Promise.all(
    (rows ?? []).map(async (row) => {
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

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <SectionHeader
          title="Incidents"
          description="All active incidents across the fleet."
        />

        {incidents.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {incidents.map((i) => (
              <IncidentCard key={i.incidentId} {...i} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No active incidents.</p>
        )}
      </div>
    </AppShell>
  );
}
