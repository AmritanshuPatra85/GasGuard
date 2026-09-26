import { cn } from "@/lib/utils";

type MetricTone = "default" | "healthy" | "warning" | "critical";

const TONE_CLASS: Record<MetricTone, string> = {
  default: "text-foreground",
  healthy: "text-status-healthy",
  warning: "text-status-warning",
  critical: "text-status-critical",
};

interface MetricCardProps {
  label: string;
  value: string | number;
  tone?: MetricTone;
  className?: string;
}

export function MetricCard({ label, value, tone = "default", className }: MetricCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-4",
        className
      )}
    >
      <p className={cn("text-3xl font-semibold tabular-nums", TONE_CLASS[tone])}>
        {value}
      </p>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mt-1">
        {label}
      </p>
    </div>
  );
}
