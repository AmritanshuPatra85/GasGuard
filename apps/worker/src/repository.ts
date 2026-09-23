import mqtt from "mqtt";
import {
  MQTT_TOPIC_PREFIX,
  parseTopic,
  TelemetryPayloadSchema,
  HeartbeatPayloadSchema,
  StatusPayloadSchema,
  MAX_CLOCK_SKEW_MS,
} from "@gasguard/shared";
import { findDeviceIdByKey, insertReading } from "./repository";

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

// ── In-memory telemetry sequence tracking ────────────────────

const lastSequenceByDevice = new Map<string, number>();

// ── MQTT client ─────────────────────────────────────────────

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

client.on("message", async (topic, payload) => {
  const parsed = parseTopic(topic);
  if (!parsed) {
    console.warn(`[worker] Invalid topic, ignoring: ${topic}`);
    return;
  }

  let data: unknown;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    console.warn(
      `[worker] Malformed JSON from ${parsed.deviceId} [${parsed.type}], skipping: ${payload.toString().slice(0, 128)}`,
    );
    return;
  }

  // ── Zod schema validation ─────────────────────────────────
  let validatedDeviceId: string;
  let validatedTimestamp: number;
  let validatedSequence: number | null = null;
  let validatedTelemetry: import("@gasguard/shared").TelemetryPayload | null = null;

  switch (parsed.type) {
    case "telemetry": {
      const result = TelemetryPayloadSchema.safeParse(data);
      if (!result.success) {
        console.warn(
          `[worker] Zod validation failed for ${parsed.deviceId} [${parsed.type}]:`,
          result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        );
        return;
      }
      validatedDeviceId = result.data.deviceId;
      validatedTimestamp = result.data.timestamp;
      validatedSequence = result.data.sequence;
      validatedTelemetry = result.data;
      break;
    }
    case "heartbeat": {
      const result = HeartbeatPayloadSchema.safeParse(data);
      if (!result.success) {
        console.warn(
          `[worker] Zod validation failed for ${parsed.deviceId} [${parsed.type}]:`,
          result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        );
        return;
      }
      validatedDeviceId = result.data.deviceId;
      validatedTimestamp = result.data.timestamp;
      break;
    }
    case "status": {
      const result = StatusPayloadSchema.safeParse(data);
      if (!result.success) {
        console.warn(
          `[worker] Zod validation failed for ${parsed.deviceId} [${parsed.type}]:`,
          result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        );
        return;
      }
      validatedDeviceId = result.data.deviceId;
      validatedTimestamp = result.data.timestamp;
      break;
    }
    default:
      console.warn(`[worker] Unhandled message type "${parsed.type}", ignoring.`);
      return;
  }

  // ── Device / topic consistency ─────────────────────────────
  if (validatedDeviceId !== parsed.deviceId) {
    console.warn(
      `[worker] Device mismatch: topic says "${parsed.deviceId}" but payload says "${validatedDeviceId}", rejecting.`,
    );
    return;
  }

  // ── Timestamp clock-skew validation ────────────────────────
  const messageTimeMs = validatedTimestamp * 1000;
  const clockSkewMs = Math.abs(Date.now() - messageTimeMs);
  if (clockSkewMs > MAX_CLOCK_SKEW_MS) {
    console.warn(
      `[worker] Rejected ${parsed.deviceId} [${parsed.type}]: timestamp rejected due to excessive clock skew (${clockSkewMs}ms).`,
    );
    return;
  }

  // ── Telemetry: sequence check + persistence ───────────────
  if (parsed.type === "telemetry" && validatedSequence !== null && validatedTelemetry) {
    const sequenceKey = `${parsed.societyId}:${parsed.deviceId}`;
    const lastSequence = lastSequenceByDevice.get(sequenceKey);

    if (lastSequence !== undefined) {
      if (validatedSequence === lastSequence) {
        console.warn(
          `[worker] Duplicate sequence ${validatedSequence} for ${parsed.deviceId}, ignoring.`,
        );
        return;
      }
      if (validatedSequence < lastSequence) {
        console.warn(
          `[worker] Out-of-order sequence ${validatedSequence} for ${parsed.deviceId} (last accepted: ${lastSequence}), rejecting.`,
        );
        return;
      }
    }

    // ── PostgreSQL persistence ──────────────────────────────
    try {
      const deviceUuid = await findDeviceIdByKey(validatedTelemetry.deviceId);

      if (!deviceUuid) {
        console.warn(
          `[worker] Unknown device key "${validatedTelemetry.deviceId}", cannot persist reading.`,
        );
        return;
      }

      await insertReading({
        deviceId: deviceUuid,
        recordedAt: new Date(validatedTelemetry.timestamp * 1000).toISOString(),
        sequence: validatedTelemetry.sequence,
        gasRaw: validatedTelemetry.gas.raw,
        gasValue: validatedTelemetry.gas.value,
        temperature: validatedTelemetry.temperature ?? null,
        humidity: validatedTelemetry.humidity ?? null,
      });

      // Only update sequence tracking after successful persistence.
      lastSequenceByDevice.set(sequenceKey, validatedSequence);

      console.log(
        `[worker] Persisted: society=${parsed.societyId} device=${parsed.deviceId} type=${parsed.type}`,
      );
    } catch (err) {
      console.error(
        `[worker] Database error for ${parsed.deviceId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    return;
  }

  console.log(
    `[worker] Validated: society=${parsed.societyId} device=${parsed.deviceId} type=${parsed.type}`,
  );
});

client.on("error", (err) => {
  console.error("[worker] MQTT error:", err.message);
});

client.on("reconnect", () => {
  console.log("[worker] Reconnecting to broker...");
});

// ── Graceful shutdown ───────────────────────────────────────

function shutdown(signal: string) {
  console.log(`[worker] Received ${signal}, shutting down...`);
  client.end(true, () => {
    console.log("[worker] MQTT connection closed.");
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));