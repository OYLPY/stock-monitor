import type { AppDatabase } from "@/db";
import { enqueueScheduledTask } from "../task-queue/queue.ts";

const timeZone = "Asia/Tokyo";
const scheduleVersion = "v1";
const reportTimeoutMs = 900_000;
const dailySchedules = [
  { type: "MORNING", time: "07:00" },
  { type: "DAILY_AUDIT", time: "16:00" },
] as const;

function localDateAt(timestampMs: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestampMs);
  const values = new Map(parts.map(({ type, value }) => [type, value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function shiftDate(localDate: string, days: number) {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function mondayOfWeek(localDate: string) {
  const weekday = new Date(`${localDate}T00:00:00Z`).getUTCDay();
  return shiftDate(localDate, -((weekday + 6) % 7));
}

export function enqueueScheduledReportJobs(
  database: AppDatabase,
  nowMs: number,
) {
  const today = localDateAt(nowMs);
  const weekStart = mondayOfWeek(today);
  const schedules = [
    ...dailySchedules.flatMap(({ type, time }) =>
      [today, shiftDate(today, 1)].map((date) => ({
        type,
        date,
        time,
      })),
    ),
    ...[weekStart, shiftDate(weekStart, 7)].map((date) => ({
      type: "WEEKLY_AUDIT" as const,
      date,
      time: "07:30",
    })),
  ];

  return schedules.map(({ type, date, time }) =>
    enqueueScheduledTask(database, {
      idempotencyKey: `report-schedule:${scheduleVersion}:${type}:${date}`,
      runType: "RESEARCH_REPORT",
      input: { type },
      timeZone,
      scheduledLocalAt: `${date}T${time}`,
      timeoutMs: reportTimeoutMs,
      createdAtMs: nowMs,
    }),
  );
}
