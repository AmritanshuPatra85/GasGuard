import type { ScenarioFn } from "../device";

/**
 * Slow leak: gas sits at the normal baseline for a quiet period, then rises
 * steadily, simulating sustained gas accumulation in an enclosed space.
 *
 * The quiet period MUST be longer than the worker's detector warm-up
 * (24 readings x 6 s = 144 s). If the leak starts during warm-up, the baseline
 * never finishes learning and only the absolute thresholds can fire.
 */
const BASELINE = 400;
const QUIET_SECONDS = 180; // longer than the 144 s warm-up, with margin
const RISE_PER_SECOND = 2.5; // +150 gas units per minute

export const slowLeakScenario: ScenarioFn = (elapsedSeconds) => {
  const noise = (Math.random() - 0.5) * 20;

  const rampSeconds = Math.max(0, elapsedSeconds - QUIET_SECONDS);
  const gasValue = Math.max(0, BASELINE + rampSeconds * RISE_PER_SECOND + noise);

  return {
    gasRaw: Math.round(gasValue * 1.06),
    gasValue,
    temperature: 27 + (Math.random() - 0.5) * 2,
    humidity: 55 + (Math.random() - 0.5) * 10,
  };
};