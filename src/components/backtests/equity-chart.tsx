"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/shadcn/chart";

const equityChartConfig = {
  equity: {
    label: "账户权益",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

function formatUtc(value: string) {
  return `${new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(Number(value)))} UTC`;
}

function formatChartUtc(value: number) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatChartEquity(value: number) {
  return `JPY ${new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: 0,
  }).format(value)}`;
}

export function EquityChart({
  points,
}: {
  points: Array<{ asOfMs: number; equity: number }>;
}) {
  return (
    <ChartContainer className="min-h-56 w-full" config={equityChartConfig}>
      <LineChart
        accessibilityLayer
        data={points}
        margin={{ left: 8, right: 12 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="asOfMs"
          minTickGap={24}
          tickFormatter={(value: number) => formatChartUtc(value)}
          tickLine={false}
          tickMargin={8}
        />
        <YAxis
          axisLine={false}
          tickFormatter={(value: number) => formatChartEquity(value)}
          tickLine={false}
          width={104}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => formatChartEquity(Number(value))}
              labelFormatter={(value) => formatUtc(String(value))}
            />
          }
        />
        <Line
          activeDot={false}
          dataKey="equity"
          dot={false}
          stroke="var(--color-equity)"
          strokeWidth={2}
          type="monotone"
        />
      </LineChart>
    </ChartContainer>
  );
}
