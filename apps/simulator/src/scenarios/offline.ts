import type { ScenarioFn } from "../device";

/**
 * Offline scenario: represents a device that stops publishing after an
 * initial period. The ScenarioFn contract cannot express "stop publishing"
 * since it must always return telemetry, so this module provides a valid
 * ScenarioFn for the initial active window alongside a constant that tells
 * the consumer when to cease publishing.
 *
 * The simulator's device loop should check OFFLINE_AFTER_SECONDS and stop
 * calling publish() once elapsedSeconds exceeds that value.
 */

/** Seconds of normal publishing before the device goes silent. */
export const OFFLINE_AFTER_SECONDS = 10;

/**
 * Normal-looking telemetry for the brief active window before the device
 * goes offline. After OFFLINE_AFTER_SECONDS the simulator should stop
 * publishing entirely rather than calling this function.
 */
export const offlineScenario: ScenarioFn = () => {
  const baseline = 400;
  const noise = (Math.random() - 0.5) * 20;
  const gasValue = Math.max(0, baseline + noise);

  return {
    gasRaw: Math.round(gasValue * 1.06),
    gasValue,
    temperature: 27 + (Math.random() - 0.5) * 2,
    humidity: 55 + (Math.random() - 0.5) * 10,
  };
};