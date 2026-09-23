import type { ScenarioFn } from "../device";

/**
 * Recovery: starts at an elevated gas level (already-abnormal condition),
 * holds that elevation briefly, then declines smoothly back toward the
 * normal baseline — simulating ventilation or a leak being sealed.
 */
export const recoveryScenario: ScenarioFn = (elapsedSeconds) => {
  const baseline = 400;
  const noise = (Math.random() - 0.5) * 20;

  // Elevated phase: +300 above baseline for the first 15 seconds
  const holdSeconds = Math.min(elapsedSeconds, 15);
  const elevation = holdSeconds > 0 ? 300 : 0;

  // After the hold, decline at 10 units per second back toward baseline
  const recoverySeconds = Math.max(0, elapsedSeconds - 15);
  const decline = Math.max(0, elevation - recoverySeconds * 10);

  const gasValue = Math.max(0, baseline + decline + noise);

  return {
    gasRaw: Math.round(gasValue * 1.06),
    gasValue,
    temperature: 27 + (Math.random() - 0.5) * 2,
    humidity: 55 + (Math.random() - 0.5) * 10,
  };
};