import { addDays } from "./format";

// Date ranges for charts that hold their whole history client-side.
export type TimelineRange = "3M" | "6M" | "1Y" | "3Y" | "ALL";

export const TIMELINE_RANGES: TimelineRange[] = ["3M", "6M", "1Y", "3Y", "ALL"];

const RANGE_DAYS: Record<TimelineRange, number> = { "3M": 92, "6M": 183, "1Y": 366, "3Y": 1096, ALL: Infinity };

export const rangeLabel = (range: TimelineRange) => (range === "ALL" ? "All" : range);

// The points within `range` of `end` (default: the last point's date).
export function trimToRange<T extends { date: string }>(points: T[], range: TimelineRange, end = points[points.length - 1]?.date): T[] {
  const days = RANGE_DAYS[range];
  if (!Number.isFinite(days) || !end) return points;
  const cutoff = addDays(end, -days);
  return points.filter(point => point.date >= cutoff);
}
