"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useChartTheme } from "@/lib/chart-theme";
import { CONTROLS, controlColor } from "@/lib/controls";

/** Stacked incidents per day (or hour) by control. `t` is YYYY-MM-DD or YYYY-MM-DDTHH:00. */
export function ControlTrend({ data, height = 260 }: { data: any[]; height?: number }) {
  const chart = useChartTheme();
  const hourly = (data[0]?.t ?? "").includes("T");
  // Only draw controls that have something in this period, so the legend
  // doesn't list six empty series.
  const present = CONTROLS.filter((c) => data.some((p) => (p[c.id] ?? 0) > 0));
  const series = data.map((p) => ({
    ...p,
    label: hourly
      ? `${p.t.slice(11, 13)}:00`
      : new Date(p.t + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
        <XAxis dataKey="label" stroke={chart.axis} fontSize={11} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis stroke={chart.axis} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
        <Tooltip
          contentStyle={chart.tooltip as any}
          labelStyle={{ color: chart.axis, fontSize: 11 }}
          itemStyle={{ fontSize: 11 }}
          cursor={{ fill: chart.grid, opacity: 0.35 }}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: chart.axis }} iconType="circle" iconSize={8} />
        {present.map((c, i) => (
          <Bar
            key={c.id}
            dataKey={c.id}
            name={c.label}
            stackId="c"
            fill={controlColor(chart, c.id)}
            radius={i === present.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
            maxBarSize={28}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
