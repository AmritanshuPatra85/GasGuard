export type MetricName =
  | "accepted"
  | "rejected"
  | "duplicate"
  | "malformedJson"
  | "schemaValidationFailed"
  | "unknownDevice"
  | "databaseErrors";

export type MetricsSnapshot = Record<MetricName, number>;

const counters: MetricsSnapshot = {
  accepted: 0,
  rejected: 0,
  duplicate: 0,
  malformedJson: 0,
  schemaValidationFailed: 0,
  unknownDevice: 0,
  databaseErrors: 0,
};

export function incrementMetric(name: MetricName): void {
  counters[name]++;
}

export function getMetrics(): MetricsSnapshot {
  return { ...counters };
}

export function resetMetrics(): void {
  counters.accepted = 0;
  counters.rejected = 0;
  counters.duplicate = 0;
  counters.malformedJson = 0;
  counters.schemaValidationFailed = 0;
  counters.unknownDevice = 0;
  counters.databaseErrors = 0;
}