import mqtt, { type MqttClient } from "mqtt";
import {
  telemetryTopic,
  heartbeatTopic,
  statusTopic,
  MQTT_QOS,
  type TelemetryPayload,
} from "@gasguard/shared";

export type ScenarioFn = (elapsedSeconds: number) => {
  gasRaw: number;
  gasValue: number;
  temperature: number | null;
  humidity: number | null;
};

export interface VirtualDeviceConfig {
  deviceId: string;
  societyId: string;
  brokerUrl: string;
  username: string;
  password: string;
  scenario: ScenarioFn;
  intervalMs: number;
  firmwareVersion?: string;
  offlineAfterSeconds?: number;
}

export class VirtualDevice {
  private client: MqttClient | null = null;
  private sequence = 0;
  private startedAt = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private readonly firmwareVersion: string;

  constructor(private readonly config: VirtualDeviceConfig) {
    this.firmwareVersion = config.firmwareVersion ?? "sim-1.0.0";
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(this.config.brokerUrl, {
        username: this.config.username,
        password: this.config.password,
        clientId: this.config.deviceId,
        clean: true,
        keepalive: 60,
        will: {
          topic: statusTopic(this.config.societyId, this.config.deviceId),
          payload: JSON.stringify({
            deviceId: this.config.deviceId,
            timestamp: Math.floor(Date.now() / 1000),
            status: "offline",
          }),
          qos: MQTT_QOS.status,
          retain: true,
        },
      });

      this.client.on("connect", () => {
        this.publishStatus("online");
        resolve();
      });

      this.client.on("error", (err) => {
        reject(err);
      });
    });
  }

  private publishStatus(status: "online" | "offline") {
    if (!this.client) return;
    this.client.publish(
      statusTopic(this.config.societyId, this.config.deviceId),
      JSON.stringify({
        deviceId: this.config.deviceId,
        timestamp: Math.floor(Date.now() / 1000),
        status,
        firmwareVersion: this.firmwareVersion,
      }),
      { qos: MQTT_QOS.status, retain: true },
    );
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.config.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.publishStatus("offline");
    this.client?.end();
  }

  private tick() {
    if (!this.client?.connected) return;

    const elapsedSeconds = (Date.now() - this.startedAt) / 1000;

    if (
      this.config.offlineAfterSeconds !== undefined &&
      elapsedSeconds >= this.config.offlineAfterSeconds
    ) {
      return;
    }

    const reading = this.config.scenario(elapsedSeconds);

    const payload: TelemetryPayload = {
      deviceId: this.config.deviceId,
      timestamp: Math.floor(Date.now() / 1000),
      sequence: this.sequence++,
      gas: { raw: reading.gasRaw, value: reading.gasValue },
      temperature: reading.temperature,
      humidity: reading.humidity,
      firmwareVersion: this.firmwareVersion,
    };

    this.client.publish(
      telemetryTopic(this.config.societyId, this.config.deviceId),
      JSON.stringify(payload),
      { qos: MQTT_QOS.telemetry },
    );

    this.client.publish(
      heartbeatTopic(this.config.societyId, this.config.deviceId),
      JSON.stringify({
        deviceId: this.config.deviceId,
        timestamp: Math.floor(Date.now() / 1000),
      }),
      { qos: MQTT_QOS.heartbeat },
    );
  }
}