"use client";

// Feature: commandbar-god-mode
// ForesightChart — inline mini chart rendered inside ToolCard for foresight simulation results.
// Phase A restyle: flat light/violet, solid stroke, single-color violet fill (no multi-color gradients).

import React from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export interface ForesightChartProps {
  chartType: "depletion_node" | "equity_curve" | "yield_curve";
  monthlyProjection: Array<Record<string, number>>;
  result: Record<string, unknown>;
}

const VIOLET = "#7c3aed"; // aurora-violet (brand)
const VIOLET_SOFT = "#a78bfa"; // violet-400 (secondary line)

function formatValue(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

const tooltipStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #ede9fe", // violet-100
  borderRadius: 8,
  fontSize: 11,
  color: "#1e293b",
  boxShadow: "none",
};

const axisTick = { fontSize: 9, fill: "#94a3b8" }; // slate-400

function ChartShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-2xl border border-violet-100 bg-white p-2.5 font-manrope">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700">
        {label}
      </p>
      {children}
    </div>
  );
}

export function ForesightChart({ chartType, monthlyProjection }: ForesightChartProps) {
  if (!monthlyProjection || monthlyProjection.length === 0) return null;

  const firstRow = monthlyProjection[0];
  const keys = Object.keys(firstRow).filter((k) => k !== "month");

  if (chartType === "depletion_node") {
    const balanceKey = keys.find((k) => k === "balance") ?? keys[0];
    const maxBalance = Math.max(...monthlyProjection.map((d) => d[balanceKey] ?? 0));

    return (
      <ChartShell label="Runway Projection">
        <ResponsiveContainer width="100%" height={110}>
          <AreaChart data={monthlyProjection} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="depletionFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={VIOLET} stopOpacity={0.22} />
                <stop offset="100%" stopColor={VIOLET} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis hide domain={[0, maxBalance * 1.05]} />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ stroke: VIOLET_SOFT, strokeWidth: 1, strokeDasharray: "3 3" }}
              formatter={(v: number) => [formatValue(v), "Balance"]}
              labelFormatter={(l: number | string) => `Month ${l}`}
            />
            <Area
              type="monotone"
              dataKey={balanceKey}
              stroke={VIOLET}
              strokeWidth={1.75}
              fill="url(#depletionFill)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartShell>
    );
  }

  if (chartType === "equity_curve") {
    const [key1, key2] = keys.length >= 2 ? [keys[0], keys[1]] : [keys[0], keys[0]];

    return (
      <ChartShell label="Equity Curve">
        <ResponsiveContainer width="100%" height={110}>
          <AreaChart data={monthlyProjection} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="equityFill1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={VIOLET} stopOpacity={0.22} />
                <stop offset="100%" stopColor={VIOLET} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis hide />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ stroke: VIOLET_SOFT, strokeWidth: 1, strokeDasharray: "3 3" }}
              formatter={(v: number) => [formatValue(v)]}
              labelFormatter={(l: number | string) => `Month ${l}`}
            />
            <Area
              type="monotone"
              dataKey={key1}
              stroke={VIOLET}
              strokeWidth={1.75}
              fill="url(#equityFill1)"
              dot={false}
            />
            {key2 !== key1 && (
              <Area
                type="monotone"
                dataKey={key2}
                stroke={VIOLET_SOFT}
                strokeWidth={1.5}
                fill="none"
                dot={false}
                strokeDasharray="4 2"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </ChartShell>
    );
  }

  // yield_curve
  const yieldKey = keys.find((k) => k === "balance" || k === "value") ?? keys[0];

  return (
    <ChartShell label="Yield Forecast">
      <ResponsiveContainer width="100%" height={110}>
        <AreaChart data={monthlyProjection} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="yieldFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={VIOLET} stopOpacity={0.22} />
              <stop offset="100%" stopColor={VIOLET} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis hide />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ stroke: VIOLET_SOFT, strokeWidth: 1, strokeDasharray: "3 3" }}
            formatter={(v: number) => [formatValue(v), "Balance"]}
            labelFormatter={(l: number | string) => `Month ${l}`}
          />
          <Area
            type="monotone"
            dataKey={yieldKey}
            stroke={VIOLET}
            strokeWidth={1.75}
            fill="url(#yieldFill)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
