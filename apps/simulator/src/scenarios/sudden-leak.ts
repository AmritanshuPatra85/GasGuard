import type { ScenarioFn } from "../device";

/**
 * Sudden leak: gas sits near the normal baseline for a brief period,
 * then rises sharply over a few seconds — simulating a pipe burst or
 * valve failure. The rapid transition stands in clear contrast to the
 * gradual ramp of the slow-leak scenario.
 */
export const suddenLeakScenario: ScenarioFn = (elapsedSeconds) => {
  const baseline = 400;
  const noise = (Math.random() - 0.5) * 20;

  // 5-second grace period where readings look essentially normal
  const spikeSeconds = Math.max(0, elapsedSeconds - 5);

  // Rapid rise: +80 units per second → +480 gas units in just 6 seconds
  const increase = spikeSeconds * 80;

  const gasValue = Math.max(0, baseline + increase + noise);

  return {
    gasRaw: Math.round(gasValue * 1.06),
    gasValue,
    temperature: 27 + (Math.random() - 0.5) * 2,
    humidity: 55 + (Math.random() - 0.5) * 10,
  };
};