export type DeviceStatus = 'online' | 'offline' | 'maintenance';
export type DeviceHealth = 'healthy' | 'degraded' | 'sensor_fault' | 'offline';
export type IncidentSeverity = 'suspicious' | 'warning' | 'critical';
export type IncidentState = 'suspicious' | 'warning' | 'critical' | 'resolved';
export type AlertChannel = 'web_push' | 'telegram' | 'whatsapp' | 'sms';
export type AlertStatus = 'created' | 'queued' | 'sent' | 'acknowledged' | 'failed';
export type MembershipRole = 'resident' | 'admin' | 'security';

export interface Society {
  id: string;
  name: string;
  city: string;
  created_at: string;
}

export interface Tower {
  id: string;
  society_id: string;
  name: string;
  location: unknown;
  created_at: string;
}

export interface Flat {
  id: string;
  tower_id: string;
  number: string;
  floor: number;
  resident_id: string | null;
  created_at: string;
}

export interface Device {
  id: string;
  flat_id: string;
  device_key: string;
  status: DeviceStatus;
  firmware_version: string | null;
  created_at: string;
}

export interface Reading {
  id: string;
  device_id: string;
  recorded_at: string;
  gas_raw: number;
  gas_value: number;
  temperature: number | null;
  humidity: number | null;
  sequence: number;
  created_at: string;
}

export interface DeviceState {
  device_id: string;
  last_seen: string;
  current_gas: number;
  health: DeviceHealth;
  updated_at: string;
}

export interface Incident {
  id: string;
  device_id: string;
  severity: IncidentSeverity;
  state: IncidentState;
  started_at: string;
  resolved_at: string | null;
  created_at: string;
}

export interface IncidentEvent {
  id: string;
  incident_id: string;
  event_type: string;
  actor: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  society_id: string;
  role: MembershipRole;
  created_at: string;
}

export interface AlertContact {
  id: string;
  user_id: string;
  society_id: string;
  role: string;
  channel: AlertChannel;
  destination: string;
  enabled: boolean;
  created_at: string;
}

export interface Alert {
  id: string;
  incident_id: string;
  contact_id: string;
  channel: AlertChannel;
  status: AlertStatus;
  created_at: string;
  acknowledged_at: string | null;
}

export interface SimulationRun {
  id: string;
  scenario: string;
  device_count: number;
  society_id: string | null;
  started_at: string;
  ended_at: string | null;
  metadata: Record<string, unknown>;
}
