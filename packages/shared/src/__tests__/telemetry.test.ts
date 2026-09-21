import { describe, it, expect } from 'vitest';
import {
  TelemetryPayloadSchema,
  HeartbeatPayloadSchema,
  StatusPayloadSchema,
} from '../schemas/telemetry';
import { parseTopic, telemetryTopic } from '../constants';

describe('TelemetryPayloadSchema', () => {
  const valid = {
    deviceId: 'ESP-0001',
    timestamp: 1769000000,
    sequence: 18492,
    gas: { raw: 438, value: 412 },
    temperature: 28.4,
    humidity: 61.2,
    firmwareVersion: '1.0.0',
  };

  it('accepts a valid payload', () => {
    expect(TelemetryPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts null temp/humidity', () => {
    const r = TelemetryPayloadSchema.safeParse({
      ...valid,
      temperature: null,
      humidity: null,
    });
    expect(r.success).toBe(true);
  });

  it('accepts without optional fields', () => {
    const { temperature, humidity, firmwareVersion, ...rest } = valid;
    expect(TelemetryPayloadSchema.safeParse(rest).success).toBe(true);
  });

  it('rejects missing deviceId', () => {
    const { deviceId: _, ...rest } = valid;
    expect(TelemetryPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty deviceId', () => {
    expect(TelemetryPayloadSchema.safeParse({ ...valid, deviceId: '' }).success).toBe(false);
  });

  it('rejects negative sequence', () => {
    expect(TelemetryPayloadSchema.safeParse({ ...valid, sequence: -1 }).success).toBe(false);
  });

  it('rejects gas.raw > 4095', () => {
    expect(
      TelemetryPayloadSchema.safeParse({ ...valid, gas: { raw: 4096, value: 100 } }).success,
    ).toBe(false);
  });

  it('rejects gas.raw < 0', () => {
    expect(
      TelemetryPayloadSchema.safeParse({ ...valid, gas: { raw: -1, value: 100 } }).success,
    ).toBe(false);
  });

  it('rejects temperature out of range', () => {
    expect(TelemetryPayloadSchema.safeParse({ ...valid, temperature: 100 }).success).toBe(false);
  });

  it('rejects humidity > 100', () => {
    expect(TelemetryPayloadSchema.safeParse({ ...valid, humidity: 101 }).success).toBe(false);
  });

  it('rejects empty object', () => {
    expect(TelemetryPayloadSchema.safeParse({}).success).toBe(false);
  });

  it('rejects non-object', () => {
    expect(TelemetryPayloadSchema.safeParse('string').success).toBe(false);
  });

  it('rejects wrong gas type', () => {
    expect(TelemetryPayloadSchema.safeParse({ ...valid, gas: 'bad' }).success).toBe(false);
  });
});

describe('HeartbeatPayloadSchema', () => {
  it('accepts minimal heartbeat', () => {
    expect(
      HeartbeatPayloadSchema.safeParse({ deviceId: 'ESP-0001', timestamp: 1769000000 }).success,
    ).toBe(true);
  });

  it('accepts with uptime and freeHeap', () => {
    expect(
      HeartbeatPayloadSchema.safeParse({
        deviceId: 'ESP-0001',
        timestamp: 1769000000,
        uptime: 3600,
        freeHeap: 120000,
      }).success,
    ).toBe(true);
  });

  it('rejects missing timestamp', () => {
    expect(HeartbeatPayloadSchema.safeParse({ deviceId: 'ESP-0001' }).success).toBe(false);
  });
});

describe('StatusPayloadSchema', () => {
  it('accepts valid online status', () => {
    expect(
      StatusPayloadSchema.safeParse({
        deviceId: 'ESP-0001',
        timestamp: 1769000000,
        status: 'online',
      }).success,
    ).toBe(true);
  });

  it('rejects unknown status value', () => {
    expect(
      StatusPayloadSchema.safeParse({
        deviceId: 'ESP-0001',
        timestamp: 1769000000,
        status: 'unknown',
      }).success,
    ).toBe(false);
  });
});

describe('parseTopic', () => {
  it('parses a valid telemetry topic', () => {
    expect(parseTopic('gasguard/v1/soc-123/ESP-0001/telemetry')).toEqual({
      societyId: 'soc-123',
      deviceId: 'ESP-0001',
      type: 'telemetry',
    });
  });

  it('parses a heartbeat topic', () => {
    const result = parseTopic('gasguard/v1/soc/ESP-1/heartbeat');
    expect(result?.type).toBe('heartbeat');
  });

  it('returns null for wrong prefix', () => {
    expect(parseTopic('other/v1/soc/dev/telemetry')).toBeNull();
  });

  it('returns null for too few segments', () => {
    expect(parseTopic('gasguard/v1/soc/dev')).toBeNull();
  });

  it('returns null for invalid type', () => {
    expect(parseTopic('gasguard/v1/soc/dev/nope')).toBeNull();
  });
});

describe('telemetryTopic', () => {
  it('builds correct topic', () => {
    expect(telemetryTopic('soc-123', 'ESP-0001')).toBe(
      'gasguard/v1/soc-123/ESP-0001/telemetry',
    );
  });
});
