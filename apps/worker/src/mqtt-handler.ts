import type { MqttClient } from "mqtt";
import {
  parseTopic,
  TelemetryPayloadSchema,
  HeartbeatPayloadSchema,
  StatusPayloadSchema,
  MAX_CLOCK_SKEW_MS,
} from "@gasguard/shared";
import type { TelemetryPayload } from "@gasguard/shared";
import { findDeviceIdByKey, enqueueReading, startReadingWriter } from "./repository";
import { updateDeviceHeartbeat } from "./heartbeat";
import { incrementMetric } from "./metrics";
import { processReading } from "./incident-engine";

// -- In-memory telemetry sequence tracking ---------------------------------

const lastSequenceByDevice = new Map<string, number>();

function rejectSchema(
  deviceId: string,
  type: string,
  issues: { path: PropertyKey[]; message: string }[],
): void {
  incrementMetric("schemaValidationFailed");
  incrementMetric("rejected");
  console.warn(
    `[worker] Zod validation failed for ${deviceId} [${type}]:`,
    issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("; "),
  );
}

export function registerMqttHandlers(client: MqttClient): void {
  startReadingWriter();

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

    // -- Zod schema validation ----------------------------------------------
    let validatedDeviceId: string;
    let validatedTimestamp: number;
    let validatedSequence: number | null = null;
    let validatedTelemetry: TelemetryPayload | null = null;

    switch (parsed.type) {
      case "telemetry": {
        const result = TelemetryPayloadSchema.safeParse(data);
        if (!result.success) {
          rejectSchema(parsed.deviceId, parsed.type, result.error.issues);
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
          rejectSchema(parsed.deviceId, parsed.type, result.error.issues);
          return;
        }
        validatedDeviceId = result.data.deviceId;
        validatedTimestamp = result.data.timestamp;
        break;
      }
      case "status": {
        const result = StatusPayloadSchema.safeParse(data);
        if (!result.success) {
          rejectSchema(parsed.deviceId, parsed.type, result.error.issues);
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

    // -- Device / topic consistency -----------------------------------------
    if (validatedDeviceId !== parsed.deviceId) {
      incrementMetric("rejected");
      console.warn(
        `[worker] Device mismatch: topic says "${parsed.deviceId}" but payload says "${validatedDeviceId}", rejecting.`,
      );
      return;
    }

    // -- Timestamp clock-skew validation ------------------------------------
    const clockSkewMs = Math.abs(Date.now() - validatedTimestamp * 1000);
    if (clockSkewMs > MAX_CLOCK_SKEW_MS) {
      incrementMetric("rejected");
      console.warn(
        `[worker] Rejected ${parsed.deviceId} [${parsed.type}]: timestamp rejected due to excessive clock skew (${clockSkewMs}ms).`,
      );
      return;
    }

    // -- Telemetry: sequence check, detect, then queue for batched insert ---
    if (parsed.type === "telemetry" && validatedSequence !== null && validatedTelemetry) {
      const sequenceKey = `${parsed.societyId}:${parsed.deviceId}`;
      const lastSequence = lastSequenceByDevice.get(sequenceKey);

      if (lastSequence !== undefined) {
        if (validatedSequence === lastSequence) {
          incrementMetric("duplicate");
          incrementMetric("rejected");
          console.warn(`[worker] Duplicate sequence ${validatedSequence} for ${parsed.deviceId}, ignoring.`);
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

      try {
        const deviceUuid = await findDeviceIdByKey(validatedTelemetry.deviceId);

        if (!deviceUuid) {
          incrementMetric("unknownDevice");
          incrementMetric("rejected");
          console.warn(`[worker] Unknown device key "${validatedTelemetry.deviceId}", cannot persist reading.`);
          return;
        }

        lastSequenceByDevice.set(sequenceKey, validatedSequence);

        // Detection: incident rows are written in the background; health goes into device_state with the reading.
        const health = processReading({
          deviceId: deviceUuid,
          deviceKey: validatedTelemetry.deviceId,
          timestampMs: validatedTelemetry.timestamp * 1000,
          value: validatedTelemetry.gas.value,
        });

        enqueueReading({
          deviceId: deviceUuid,
          recordedAt: new Date(validatedTelemetry.timestamp * 1000).toISOString(),
          sequence: validatedTelemetry.sequence,
          gasRaw: validatedTelemetry.gas.raw,
          gasValue: validatedTelemetry.gas.value,
          temperature: validatedTelemetry.temperature ?? null,
          humidity: validatedTelemetry.humidity ?? null,
          health,
        });
      } catch (err) {
        incrementMetric("databaseErrors");
        incrementMetric("rejected");
        console.error(
          `[worker] Device lookup error for ${parsed.deviceId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }

      return;
    }

    // -- Heartbeat: liveness persistence ------------------------------------
    if (parsed.type === "heartbeat") {
      try {
        const deviceUuid = await findDeviceIdByKey(validatedDeviceId);

        if (!deviceUuid) {
          incrementMetric("unknownDevice");
          incrementMetric("rejected");
          console.warn(`[worker] Unknown device key "${validatedDeviceId}", cannot persist heartbeat.`);
          return;
        }

        await updateDeviceHeartbeat({
          deviceId: deviceUuid,
          lastSeen: new Date(validatedTimestamp * 1000).toISOString(),
        });

        incrementMetric("accepted");
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

    // -- Status: validation-only --------------------------------------------
    incrementMetric("accepted");
  });
}