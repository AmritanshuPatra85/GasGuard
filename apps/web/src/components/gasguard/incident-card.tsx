import Link from "next/link";
import { StatusBadge } from "./status-badge";

type IncidentSeverity = "warning" | "critical";

interface IncidentCardProps {
  incidentId: string;
  locationLabel: string;
  severity: IncidentSeverity;
  triggerGasValue: number;
  startedAt: Date | string;
  acknowledged: boolean;
}

export function IncidentCard({
  incidentId,
  locationLabel,
  severity,
  triggerGasValue,
  startedAt,
  acknowledged,
}: IncidentCardProps) {
  const unackedCritical = severity === "critical" && !acknowledged;

  return (
    <Link
      href={`/incidents/${incidentId}`}
      className={`flex flex-col gap-3 rounded-lg border bg-surface p-4 transition-colors hover:border-border/50 ${
        unackedCritical ? "border-status-critical" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-text">{locationLabel}</span>
        <StatusBadge status={severity} label={severityLabel(severity)} />
      </div>

      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-2xl font-bold text-text">{triggerGasValue}</div>
          <div className="text-xs uppercase tracking-wide text-muted">
            Trigger Value
          </div>
        </div>
        <div className="text-xs text-muted">{formatStartedAt(startedAt)}</div>
      </div>

      <div className="flex items-center gap-1.5 text-xs">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            acknowledged ? "bg-muted" : "bg-status-critical"
          }`}
        />
        <span className={acknowledged ? "text-muted" : "text-text"}>
          {acknowledged ? "Acknowledged" : "Unacknowledged"}
        </span>
      </div>
    </Link>
  );
}

function severityLabel(severity: IncidentSeverity): string {
  return severity === "critical" ? "Critical" : "Warning";
}

function formatStartedAt(startedAt: Date | string): string {
  const date = typeof startedAt === "string" ? new Date(startedAt) : startedAt;
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}
