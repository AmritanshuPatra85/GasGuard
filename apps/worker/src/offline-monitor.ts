import { markOfflineDevices, OFFLINE_TIMEOUT_MS } from "./offline";
import { incrementMetric } from "./metrics";

export const OFFLINE_CHECK_INTERVAL_MS = 5_000;

/**
 * Periodically marks devices offline when last_seen exceeds the timeout.
 * Returns the interval handle, because index.ts stops it with clearInterval().
 *
 * With a 15s timeout and a 5s check interval, detection latency is 15-20s.
 */
export function startOfflineMonitor(): ReturnType<typeof setInterval> {
  let running = false;

  console.log(
    `[worker] Offline monitor started (timeout=${OFFLINE_TIMEOUT_MS}ms, check every ${OFFLINE_CHECK_INTERVAL_MS}ms)`,
  );

  return setInterval(async () => {
    // Skip a tick if the previous check is still in flight.
    if (running) return;
    running = true;

    try {
      const count = await markOfflineDevices();
      if (count > 0) {
        console.log(`[worker] Marked ${count} device(s) offline`);
      }
    } catch (err) {
      // An unhandled rejection inside a timer callback would crash the process.
      incrementMetric("databaseErrors");
      console.error(
        "[worker] Offline monitor error:",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      running = false;
    }
  }, OFFLINE_CHECK_INTERVAL_MS);
}