import type { ScenarioFn } from "../device";

/**
 * Sensor malfunction: generates bad telemetry in predictable phases based
 * on elapsed time — stuck flat value, then implausible spikes, then wildly
 * erratic noise. Mimics a failing MQ sensor that hasn't been serviced.
 */
export const sensorMalfunctionScenario: ScenarioFn = (elapsedSeconds) => {
  const baseline = 400;
  const phase = Math.floor(elapsedSeconds / 15) % 3;
  const noise = (Math.random() - 0.5) * 20;

  let gasValue: number;

  if (phase === 0) {
    // Phase 0 (0–15s): stuck at one flat value regardless of reality
    gasValue = 512.7;
  } else if (phase === 1) {
    // Phase 1 (15–30s): implausible spikes alternating with near-zero drops
    const tick = Math.floor(elapsedSeconds % 4);
    if (tick === 0 || tick === 1) {
      gasValue = 3800 + (Math.random() - 0.5) * 40; // near max
    } else {
      gasValue = Math.max(0, 3 + (Math.random() - 0.5) * 4); // near zero
    }
  } else {
    // Phase 2 (30s+): wildly erratic noise with no meaningful signal
    gasValue = Math.max(0, baseline + (Math.random() - 0.5) * 600);
  }

  gasValue = Math.max(0, gasValue);

  return {
    gasRaw: Math.round(gasValue * 1.06),
    gasValue,
    temperature: 27 + (Math.random() - 0.5) * 2,
    humidity: 55 + (Math.random() - 0.5) * 10,
  };
};