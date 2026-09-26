import { cn } from "@/lib/utils";

type Status = "healthy" | "warning" | "critical" | "offline";

const STATUS_CONFIG: Record<Status, { label: string; dotClass: string; textClass: string }> = {
  healthy: {
    label: "Healthy",
    dotClass: "bg-status-healthy",
    textClass: "text-status-healthy",
  },
  warning: {
    label: "Warning",
    dotClass: "bg-status-warning",
    textClass: "text-status-warning",
  },
  critical: {
    label: "Critical",
    dotClass: "bg-status-critical",
    textClass: "text-status-critical",
  },
  offline: {
    label: "Offline",
    dotClass: "bg-status-offline",
    textClass: "text-status-offline",
  },
};

interface StatusBadgeProps {
  status: Status;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-medium",
        config.textClass,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dotClass)} />
      {config.label}
    </span>
  );
}
