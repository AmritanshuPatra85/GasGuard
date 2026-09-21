export const MQTT_TOPIC_PREFIX = 'gasguard/v1';

export const MQTT_QOS = {
  telemetry: 1,
  heartbeat: 0,
  status: 1,
  commands: 1,
} as const;

export function telemetryTopic(societyId: string, deviceId: string): string {
  return `${MQTT_TOPIC_PREFIX}/${societyId}/${deviceId}/telemetry`;
}

export function heartbeatTopic(societyId: string, deviceId: string): string {
  return `${MQTT_TOPIC_PREFIX}/${societyId}/${deviceId}/heartbeat`;
}

export function statusTopic(societyId: string, deviceId: string): string {
  return `${MQTT_TOPIC_PREFIX}/${societyId}/${deviceId}/status`;
}

export function commandTopic(societyId: string, deviceId: string): string {
  return `${MQTT_TOPIC_PREFIX}/${societyId}/${deviceId}/commands`;
}

export interface ParsedTopic {
  societyId: string;
  deviceId: string;
  type: 'telemetry' | 'heartbeat' | 'status' | 'commands';
}

const VALID_TYPES = new Set(['telemetry', 'heartbeat', 'status', 'commands']);

export function parseTopic(topic: string): ParsedTopic | null {
  const parts = topic.split('/');
  if (
    parts.length !== 5 ||
    parts[0] !== 'gasguard' ||
    parts[1] !== 'v1' ||
    !VALID_TYPES.has(parts[4])
  ) {
    return null;
  }
  return {
    societyId: parts[2],
    deviceId: parts[3],
    type: parts[4] as ParsedTopic['type'],
  };
}

export const GAS_RAW_MIN = 0;
export const GAS_RAW_MAX = 4095;
export const TEMP_MIN = -40;
export const TEMP_MAX = 80;
export const HUMIDITY_MIN = 0;
export const HUMIDITY_MAX = 100;
export const MAX_CLOCK_SKEW_MS = 60_000;
