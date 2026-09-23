import type { MqttClient } from "mqtt";
import {
  parseTopic,
  TelemetryPayloadSchema,
  HeartbeatPayloadSchema,
  StatusPayloadSchema,
  MAX_CLOCK_SKEW_MS,
} from "@gasguard/shared";
import { findDeviceIdByKey, insertReading } from "./repository";
import { updateDeviceState } from "./state";
import { updateDeviceHeartbeat } from "./heartbeat";
import { incrementMetric } from "./metrics";

// ── In-memory telemetry sequence tracking ────────────────────

const lastSequenceByDevice = new Map<string, number>();

export function registerMqttHandlers(client: MqttClient): void {
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
      incrementMetric("malformedJson");
      incrementMetric("rejected");
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
          incrementMetric("schemaValidationFailed");
          incrementMetric("rejected");
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
          incrementMetric("schemaValidationFailed");
          incrementMetric("rejected");
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
          incrementMetric("schemaValidationFailed");
          incrementMetric("rejected");
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
      incrementMetric("rejected");
      console.warn(
        `[worker] Device mismatch: topic says "${parsed.deviceId}" but payload says "${validatedDeviceId}", rejecting.`,
      );
      return;
    }

    // ── Timestamp clock-skew validation ────────────────────────
    const messageTimeMs = validatedTimestamp * 1000;
    const clockSkewMs = Math.abs(Date.now() - messageTimeMs);
    if (clockSkewMs > MAX_CLOCK_SKEW_MS) {
      incrementMetric("rejected");
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
          incrementMetric("duplicate");
          incrementMetric("rejected");
          console.warn(
            `[worker] Duplicate sequence ${validatedSequence} for ${parsed.deviceId}, ignoring.`,
          );
          return;
        }
        if (validatedSequence < lastSequence) {
          incrementMetric("rejected");
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
          incrementMetric("unknownDevice");
          incrementMetric("rejected");
          console.warn(
            `[worker] Unknown device key "${validatedTelemetry.deviceId}", cannot persist reading.`,
          );
          return;
        }

        const insertResult = await insertReading({
          deviceId: deviceUuid,
          recordedAt: new Date(validatedTelemetry.timestamp * 1000).toISOString(),
          sequence: validatedTelemetry.sequence,
          gasRaw: validatedTelemetry.gas.raw,
          gasValue: validatedTelemetry.gas.value,
          temperature: validatedTelemetry.temperature ?? null,
          humidity: validatedTelemetry.humidity ?? null,
        });

        if (insertResult === "duplicate") {
          // Already stored (e.g. replay after a worker restart).
          // Remember the sequence so in-memory tracking catches up with the DB.
          lastSequenceByDevice.set(sequenceKey, validatedSequence);
          incrementMetric("duplicate");
          incrementMetric("rejected");
          console.warn(
            `[worker] Duplicate sequence ${validatedSequence} for ${parsed.deviceId} already in database, ignoring.`,
          );
          return;
        }

        await updateDeviceState({
          deviceId: deviceUuid,
          lastSeen: new Date(validatedTelemetry.timestamp * 1000).toISOString(),
          currentGas: validatedTelemetry.gas.value,
          health: "ok",
        });

        // Only update sequence tracking after successful persistence.
        lastSequenceByDevice.set(sequenceKey, validatedSequence);
        incrementMetric("accepted");

        console.log(
          `[worker] Persisted: society=${parsed.societyId} device=${parsed.deviceId} type=${parsed.type}`,
        );
      } catch (err) {
        incrementMetric("databaseErrors");
        incrementMetric("rejected");
        console.error(
          `[worker] Database error for ${parsed.deviceId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }

      return;
    }

    // ── Heartbeat: liveness persistence ───────────────────────
    if (parsed.type === "heartbeat") {
      try {
        const deviceUuid = await findDeviceIdByKey(validatedDeviceId);

        if (!deviceUuid) {
          incrementMetric("unknownDevice");
          incrementMetric("rejected");
          console.warn(
            `[worker] Unknown device key "${validatedDeviceId}", cannot persist heartbeat.`,
          );
          return;
        }

        await updateDeviceHeartbeat({
          deviceId: deviceUuid,
          lastSeen: new Date(validatedTimestamp * 1000).toISOString(),
        });

        incrementMetric("accepted");

        console.log(
          `[worker] Heartbeat recorded: society=${parsed.societyId} device=${parsed.deviceId}`,
        );
      } catch (err) {
        incrementMetric("databaseErrors");
        incrementMetric("rejected");
        console.error(
          `[worker] Heartbeat database error for ${parsed.deviceId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }

      return;
    }

    // ── Status: validation-only ───────────────────────────────
    incrementMetric("accepted");

    console.log(
      `[worker] Validated: society=${parsed.societyId} device=${parsed.deviceId} type=${parsed.type}`,
    );
  });
}