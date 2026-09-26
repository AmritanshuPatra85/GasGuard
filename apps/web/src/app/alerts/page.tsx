import { AppShell } from "@/components/gasguard/app-shell";
import { SectionHeader } from "@/components/gasguard/section-header";
import { createClient } from "@/lib/supabase/server";
import { formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const supabase = await createClient();

  const { data: alerts } = await supabase
    .from("alerts")
    .select(
      `
      id,
      channel,
      status,
      created_at,
      incidents ( id, severity, device_id ),
      alert_contacts ( role, destination )
    `,
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <SectionHeader
          title="Alerts"
          description="Notification and escalation history."
        />

        {alerts && alerts.length > 0 ? (
          <div className="flex flex-col gap-3">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between rounded-lg border border-border bg-surface p-4"
              >
                <div>
                  <p className="text-sm text-foreground">
                    {alert.incidents?.severity ?? "unknown"} incident \u2192{" "}
                    {alert.alert_contacts?.role ?? "contact"} via {alert.channel}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                  </p>
                </div>
                <span className="text-xs uppercase text-muted-foreground">
                  {alert.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No alerts have been sent yet.
          </p>
        )}
      </div>
    </AppShell>
  );
}
