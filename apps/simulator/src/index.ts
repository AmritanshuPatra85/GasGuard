import { startFleet, generateDeviceIds } from "./fleet";
import type { ScenarioFn } from "./device";
import { normalScenario } from "./scenarios/normal";
import { slowLeakScenario } from "./scenarios/slow-leak";
import { suddenLeakScenario } from "./scenarios/sudden-leak";
import { recoveryScenario } from "./scenarios/recovery";
import { sensorMalfunctionScenario } from "./scenarios/sensor-malfunction";
import { offlineScenario, OFFLINE_AFTER_SECONDS } from "./scenarios/offline";

// ── Scenario registry ────────────────────────────────────────

const SCENARIOS: Record<string, ScenarioFn> = {
  normal: normalScenario,
  "slow-leak": slowLeakScenario,
  "sudden-leak": suddenLeakScenario,
  recovery: recoveryScenario,
  "sensor-malfunction": sensorMalfunctionScenario,
  offline: offlineScenario,
};

// ── Environment parsing ──────────────────────────────────────

function parsePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`${name} must be a positive integer, got "${raw}"`);
    process.exit(1);
  }
  return value;
}

const brokerUrl = process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1883";
const societyId = process.env.SOCIETY_ID ?? "test-society";
const deviceCount = parsePositiveInt(
  "SIMULATOR_DEVICE_COUNT",
  process.env.SIMULATOR_DEVICE_COUNT,
  1,
);
const intervalMs = parsePositiveInt(
  "SIMULATOR_INTERVAL_MS",
  process.env.SIMULATOR_INTERVAL_MS,
  6000,
);
const scenarioName = process.env.SIMULATOR_SCENARIO ?? "normal";

if (!Object.hasOwn(SCENARIOS, scenarioName)) {
  console.error(
    `Unknown SIMULATOR_SCENARIO "${scenarioName}". Valid: ${Object.keys(SCENARIOS).join(", ")}`,
  );
  process.exit(1);
}
const scenario = SCENARIOS[scenarioName];

// Every simulated device authenticates as username = deviceId, sharing one
// password. The password comes from the environment, never from source.
const devicePassword = process.env.SIMULATOR_DEVICE_PASSWORD;
if (!devicePassword) {
  console.error("Missing required environment variable: SIMULATOR_DEVICE_PASSWORD");
  process.exit(1);
}

const credentials = new Map<string, { username: string; password: string }>();
for (const deviceId of generateDeviceIds(deviceCount)) {
  credentials.set(deviceId, { username: deviceId, password: devicePassword });
}

// Only the offline scenario stops publishing on its own. Setting this for
// other scenarios would silence the whole fleet after 10 seconds.
const offlineAfterSeconds = scenarioName === "offline" ? OFFLINE_AFTER_SECONDS : undefined;

// ── Run ──────────────────────────────────────────────────────

async function main() {
  console.log(
    `[simulator] broker=${brokerUrl} society=${societyId} devices=${deviceCount} ` +
      `interval=${intervalMs}ms scenario=${scenarioName}` +
      (offlineAfterSeconds !== undefined ? ` offlineAfter=${offlineAfterSeconds}s` : ""),
  );

  const fleet = await startFleet({
    deviceCount,
    societyId,
    brokerUrl,
    scenario,
    intervalMs,
    credentials,
    offlineAfterSeconds,
  });

  function shutdown(signal: string) {
    console.log(`\n[simulator] Received ${signal}, stopping fleet...`);
    fleet.stopAll();
    // Give the final "offline" status publishes a moment to flush.
    setTimeout(() => process.exit(0), 500);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[simulator] Failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});