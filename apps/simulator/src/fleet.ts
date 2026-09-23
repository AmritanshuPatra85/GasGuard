import { VirtualDevice, type ScenarioFn } from "./device";

export interface FleetDeviceSpec {
  deviceId: string;
  societyId: string;
  scenario: ScenarioFn;
}

export interface FleetConfig {
  brokerUrl: string;
  devices: FleetDeviceSpec[];
  intervalMs: number;
  /** Per-device MQTT credentials, keyed by deviceId. */
  credentials: Map<string, { username: string; password: string }>;
}

export class Fleet {
  private devices: VirtualDevice[] = [];

  constructor(private readonly config: FleetConfig) {}

  async startAll(): Promise<void> {
    for (const spec of this.config.devices) {
      const creds = this.config.credentials.get(spec.deviceId);
      if (!creds) {
        console.warn(`No credentials for ${spec.deviceId}, skipping`);
        continue;
      }

      const device = new VirtualDevice({
        deviceId: spec.deviceId,
        societyId: spec.societyId,
        brokerUrl: this.config.brokerUrl,
        username: creds.username,
        password: creds.password,
        scenario: spec.scenario,
        intervalMs: this.config.intervalMs,
      });

      try {
        await device.connect();
        device.start();
        this.devices.push(device);
      } catch (err) {
        console.error(`Failed to connect ${spec.deviceId}:`, err);
      }
    }

    console.log(`Fleet started: ${this.devices.length} devices connected.`);
  }

  stopAll(): void {
    for (const device of this.devices) {
      device.stop();
    }
    this.devices = [];
  }
}