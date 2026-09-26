import Link from "next/link";
import { StatusBadge } from "./status-badge";

type DeviceStatus = "healthy" | "warning" | "critical" | "offline";

interface DeviceCardProps {
  deviceId: string;
  locationLabel: string;
  status: DeviceStatus;
  latestGasValue: number;
  lastSeenAt: Date | string;
}

export function DeviceCard({
  deviceId,
  locationLabel,
  status,
  latestGasValue,
  lastSeenAt,
}: DeviceCardProps) {
  return (
    <Link
      href={`/devices/${deviceId}`}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border/50"
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-text">{locationLabel}</span>
        <StatusBadge status={status} label={statusLabel(status)} />
      </div>

      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-2xl font-bold text-text">{latestGasValue}</div>
          <div className="text-xs uppercase tracking-wide text-muted">
            Gas Value
          </div>
        </div>
        <div className="text-xs text-muted">{formatLastSeen(lastSeenAt)}</div>
      </div>
    </Link>
  );
}

function statusLabel(status: DeviceStatus): string {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "warning":
      return "Warning";
    case "critical":
      return "Critical";
    case "offline":
      return "Offline";
  }
}

function formatLastSeen(lastSeenAt: Date | string): string {
  const date = typeof lastSeenAt === "string" ? new Date(lastSeenAt) : lastSeenAt;
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}
