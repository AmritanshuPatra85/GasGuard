import mqtt from "mqtt";
import { MQTT_TOPIC_PREFIX } from "@gasguard/shared";
import { registerMqttHandlers } from "./mqtt-handler";
import { startOfflineMonitor } from "./offline-monitor";

// ── Environment validation ───────────────────────────────────

const brokerUrl = process.env.MQTT_BROKER_URL;
const username = process.env.MQTT_USERNAME;
const password = process.env.MQTT_PASSWORD;

if (!brokerUrl || !username || !password) {
  console.error("Missing required environment variables:");
  if (!brokerUrl) console.error("  MQTT_BROKER_URL");
  if (!username) console.error("  MQTT_USERNAME");
  if (!password) console.error("  MQTT_PASSWORD");
  process.exit(1);
}

// ── MQTT client ──────────────────────────────────────────────

const client = mqtt.connect(brokerUrl, {
  username,
  password,
  clientId: "gasguard-worker",
  clean: true,
  reconnectPeriod: 3000,
  keepalive: 60,
});

client.on("connect", () => {
  console.log("[worker] Connected to MQTT broker");

  const topics = [
    `${MQTT_TOPIC_PREFIX}/+/+/telemetry`,
    `${MQTT_TOPIC_PREFIX}/+/+/heartbeat`,
    `${MQTT_TOPIC_PREFIX}/+/+/status`,
  ];

  client.subscribe(topics, { qos: 1 }, (err) => {
    if (err) {
      console.error("[worker] Failed to subscribe:", err.message);
    } else {
      console.log("[worker] Subscribed to:", topics.join(", "));
      console.log("[worker] Ready to receive messages.");
    }
  });
});

client.on("error", (err) => {
  console.error("[worker] MQTT error:", err.message);
});

client.on("reconnect", () => {
  console.log("[worker] Reconnecting to broker...");
});

// ── Register message handlers ────────────────────────────────

registerMqttHandlers(client);

// ── Start offline monitor ────────────────────────────────────

const offlineMonitor = startOfflineMonitor();

// ── Graceful shutdown ───────────────────────────────────────

function shutdown(signal: string) {
  console.log(`[worker] Received ${signal}, shutting down...`);
  clearInterval(offlineMonitor);
  client.end(true, () => {
    console.log("[worker] MQTT connection closed.");
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));