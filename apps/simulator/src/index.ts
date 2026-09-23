import { Fleet } from "./fleet";
import { normalScenario } from "./scenarios/normal";

const BROKER_URL = process.env.MQTT_BROKER_URL ?? "mqtt://localhost:1883";
const SOCIETY_ID = process.env.SIM_SOCIETY_ID ?? "test-society";

// Sprint 2.1: prove one device works end to end before scaling to 500.
// Credentials must already exist in dynamic-security.json (Phase 1).
const credentials = new Map([
  ["esp-0001", { username: "esp-0001", password: "esp0001pass123" }],
]);

const fleet = new Fleet({
  brokerUrl: BROKER_URL,
  intervalMs: 6000, // 10 readings/min, per blueprint's scale target
  devices: [{ deviceId: "esp-0001", societyId: SOCIETY_ID, scenario: normalScenario }],
  credentials,
});

async function main() {
  await fleet.startAll();

  process.on("SIGINT", () => {
    console.log("\nStopping fleet...");
    fleet.stopAll();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Simulator failed to start:", err);
  process.exit(1);
});