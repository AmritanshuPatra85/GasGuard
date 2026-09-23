import { VirtualDevice, type ScenarioFn } from "./device";

export interface FleetDeviceSpec {
  deviceId: string;
  societyId: string;
  scenario: ScenarioFn;
  offlineAfterSeconds?: number;
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
        offlineAfterSeconds: spec.offlineAfterSeconds,
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

export interface StartFleetOptions {
  deviceCount: number;
  societyId: string;
  brokerUrl: string;
  scenario: ScenarioFn;
  intervalMs: number;
  credentials: Map<string, { username: string; password: string }>;
  offlineAfterSeconds?: number;
}

export interface RunningFleet {
  devices: VirtualDevice[];
  stopAll(): void;
}

export function generateDeviceIds(count: number): string[] {
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    ids.push(`esp-${String(i).padStart(4, "0")}`);
  }
  return ids;
}

export async function startFleet(options: StartFleetOptions): Promise<RunningFleet> {
  const { deviceCount, societyId, brokerUrl, scenario, intervalMs, credentials, offlineAfterSeconds } = options;

  if (deviceCount <= 0) {
    throw new Error(`deviceCount must be positive, got ${deviceCount}`);
  }

  // Generate deterministic device IDs: esp-0001 … esp-N
  const deviceIds = generateDeviceIds(deviceCount);

  // Validate that every device has credentials before starting anything.
  const missing: string[] = [];
  for (const deviceId of deviceIds) {
    if (!credentials.has(deviceId)) {
      missing.push(deviceId);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing MQTT credentials for ${missing.length} device(s): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", …" : ""}`,
    );
  }

  // Start every device.
  const devices: VirtualDevice[] = [];

  for (const deviceId of deviceIds) {
    const creds = credentials.get(deviceId)!;

    const device = new VirtualDevice({
      deviceId,
      societyId,
      brokerUrl,
      username: creds.username,
      password: creds.password,
      scenario,
      intervalMs,
      offlineAfterSeconds,
    });

    try {
      await device.connect();
      device.start();
      devices.push(device);
    } catch (err) {
      console.error(`Failed to connect ${deviceId}:`, err);
    }
  }

  console.log(`Fleet started: ${devices.length} devices connected.`);

  return {
    devices,
    stopAll(): void {
      for (const device of devices) {
        device.stop();
      }
      devices.length = 0;
    },
  };
}