type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function parseLocalDateTime(value: string): LocalDateTime {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value,
  );
  if (!match) throw new Error("scheduled_local_time_invalid");

  const [, year, month, day, hour, minute, second = "00"] = match;
  const result = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
  const parsed = new Date(
    Date.UTC(
      result.year,
      result.month - 1,
      result.day,
      result.hour,
      result.minute,
      result.second,
    ),
  );
  if (
    result.year < 100 ||
    parsed.getUTCFullYear() !== result.year ||
    parsed.getUTCMonth() + 1 !== result.month ||
    parsed.getUTCDate() !== result.day ||
    result.hour > 23 ||
    result.minute > 59 ||
    result.second > 59
  ) {
    throw new Error("scheduled_local_time_invalid");
  }
  return result;
}

function datePartsAt(formatter: Intl.DateTimeFormat, timestampMs: number) {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(timestampMs)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function sameLocalTime(left: LocalDateTime, right: LocalDateTime) {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

export function resolveScheduledAt(localDateTime: string, timeZone: string) {
  const target = parseLocalDateTime(localDateTime);
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new Error("scheduled_time_zone_invalid");
  }

  const localAsUtcMs = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  );
  const offsets = new Set<number>();
  for (let offsetHours = -48; offsetHours <= 48; offsetHours += 6) {
    const probeMs = localAsUtcMs + offsetHours * 60 * 60 * 1_000;
    const parts = datePartsAt(formatter, probeMs);
    offsets.add(
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      ) - probeMs,
    );
  }

  const candidates = [...offsets]
    .map((offsetMs) => localAsUtcMs - offsetMs)
    .filter((candidateMs) =>
      sameLocalTime(datePartsAt(formatter, candidateMs), target),
    );
  if (candidates.length === 0)
    throw new Error("scheduled_local_time_does_not_exist");
  if (candidates.length > 1)
    throw new Error("scheduled_local_time_is_ambiguous");
  return candidates[0];
}
