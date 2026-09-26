"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { format } from "date-fns"; // swap if you're using a different date util

interface Reading {
  recorded_at: string;
  gas_value: number;
  temperature: number | null;
  humidity: number | null;
}

interface DeviceChartProps {
  readings: Reading[];
}

export function DeviceChart({ readings }: DeviceChartProps) {
  const data = readings.map((r) => ({
    time: r.recorded_at,
    gasValue: r.gas_value,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis
          dataKey="time"
          tickFormatter={(t) => format(new Date(t), "HH:mm")}
          stroke="var(--color-muted)"
          fontSize={12}
        />
        <YAxis stroke="var(--color-muted)" fontSize={12} />
        <Tooltip
          labelFormatter={(t) => format(new Date(t), "PPpp")}
          contentStyle={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
          }}
        />
        <Line
          type="monotone"
          dataKey="gasValue"
          stroke="var(--color-accent)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
