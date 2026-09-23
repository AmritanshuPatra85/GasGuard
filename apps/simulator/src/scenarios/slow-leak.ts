import type { ScenarioFn } from "../device";

/**
 * Slow leak: gas starts near the normal baseline and rises gradually
 * over time, simulating a sustained gas accumulation in an enclosed space.
 * The ramp is smooth so that detection logic must rely on persistence
 * rather than a single spike.
 */
export const slowLeakScenario: ScenarioFn = (elapsedSeconds) => {
  const baseline = 400;
  const noise = (Math.random() - 0.5) * 20;

  // 10-second grace period where readings look essentially normal
  const rampSeconds = Math.max(0, elapsedSeconds - 10);

  // 2.5 units per second → +150 gas units per minute of sustained leak
  const increase = rampSeconds * 2.5;

  const gasValue = Math.max(0, baseline + increase + noise);

  return {
    gasRaw: Math.round(gasValue * 1.06),
    gasValue,
    temperature: 27 + (Math.random() - 0.5) * 2,
    humidity: 55 + (Math.random() - 0.5) * 10,
  };
};