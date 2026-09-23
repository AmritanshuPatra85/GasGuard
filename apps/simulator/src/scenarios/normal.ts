import type { ScenarioFn } from "../device";

/**
 * Healthy baseline: gas hovers around a stable value with small
 * random noise. This is what most of the fleet should be running,
 * so it must NEVER trip detection thresholds on its own.
 */
export const normalScenario: ScenarioFn = (_elapsedSeconds) => {
  const baseline = 400; // arbitrary stable ppm-equivalent
  const noise = (Math.random() - 0.5) * 20; // ±10 jitter
  const gasValue = Math.max(0, baseline + noise);

  return {
    gasRaw: Math.round(gasValue * 1.06), // rough raw/value relationship
    gasValue,
    temperature: 27 + (Math.random() - 0.5) * 2,
    humidity: 55 + (Math.random() - 0.5) * 10,
  };
};