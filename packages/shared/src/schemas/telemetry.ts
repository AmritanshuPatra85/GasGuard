import { z } from 'zod';

export const GasReadingSchema = z.object({
  raw: z.number().int().min(0).max(4095),
  value: z.number().min(0),
});
export type GasReading = z.infer<typeof GasReadingSchema>;

export const TelemetryPayloadSchema = z.object({
  deviceId: z.string().min(1).max(64),
  timestamp: z.number().int().positive(),
  sequence: z.number().int().nonnegative(),
  gas: GasReadingSchema,
  temperature: z.number().min(-40).max(80).nullable().optional(),
  humidity: z.number().min(0).max(100).nullable().optional(),
  firmwareVersion: z.string().max(32).optional(),
});
export type TelemetryPayload = z.infer<typeof TelemetryPayloadSchema>;

export const HeartbeatPayloadSchema = z.object({
  deviceId: z.string().min(1).max(64),
  timestamp: z.number().int().positive(),
  uptime: z.number().int().nonnegative().optional(),
  freeHeap: z.number().int().nonnegative().optional(),
});
export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;

export const StatusPayloadSchema = z.object({
  deviceId: z.string().min(1).max(64),
  timestamp: z.number().int().positive(),
  status: z.enum(['online', 'offline', 'maintenance']),
  firmwareVersion: z.string().max(32).optional(),
  reason: z.string().max(256).optional(),
});
export type StatusPayload = z.infer<typeof StatusPayloadSchema>;
