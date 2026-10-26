import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChartLegend } from "./ChartLegend";

/*
 * Generic time-series chart: any number of line/step series, optional
 * markers, a readout above the chart (nothing is drawn over the data), a
 * crosshair that snaps to dates, keyboard support, and a clickable legend that
 * shows or hides each series. Used for NAV history, portfolio value and the
 * chart builder.
 */

export interface TimeSeries {
  key: string;
  label: string;
  color: string;
  points: { date: string; value: number }[];
  // "smooth": monotone curve (continuous series like NAV); "line": straight
  // segments (series that jump, like portfolio value when money is added);
  // "step": a stepped line (money put in).
  shape?: "smooth" | "line" | "step";
  area?: boolean;
}

export interface Marker {
  date: string;
  value: number;
  label: string;
}

export interface ReadoutState {
  date: string;
  values: Record<string, number | undefined>;
  markers: Marker[];
  hovering: boolean;
  visible: Set<string>;
}

interface Props {
  series: TimeSeries[];
  height?: number;
  fromZero?: boolean;
  formatAxis: (value: number) => string;
  markers?: Marker[];
  markersLabel?: string;
  renderReadout: (state: ReadoutState) => ReactNode;
  ariaLabel: string;
  animationKey?: string;
  // Controls shown at the right of the legend (e.g. the range selector).
  toolbar?: ReactNode;
  // Series keys hidden until the person turns them on.
  initiallyHidden?: string[];
}

const MARKERS_KEY = "__markers";
const time = (date: string) => Date.parse(`${date}T00:00:00Z`);

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1;
  const rough = span / count;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * power).find(s => s >= rough) ?? rough;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

// Monotone cubic interpolation (Fritsch–Carlson): smooth, but never overshoots
// the data, so a curve never shows a value that didn't happen.
function smoothPath(points: [number, number][]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n < 3) return linePath(points);

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1][0] - points[i][0];
    slope[i] = dx[i] === 0 ? 0 : (points[i + 1][1] - points[i][1]) / dx[i];
  }

  const tangent: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / slope[i - 1] + (dx[i] + 2 * dx[i - 1]) / slope[i]);
  }
  tangent[n - 1] = slope[n - 2];

  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = dx[i] / 3;
    d += `C${x0 + h},${y0 + h * tangent[i]} ${x1 - h},${y1 - h * tangent[i + 1]} ${x1},${y1}`;
  }
  return d;
}

function linePath(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join("");
}

function stepPath(points: [number, number][]): string {
  return points.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `H${x}V${y}`)).join("");
}

const monthYear = new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
const yearOnly = new Intl.DateTimeFormat(undefined, { year: "numeric", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function TimeChart({
  series,
  height = 280,
  fromZero = false,
  formatAxis,
  markers = [],
  markersLabel = "Your purchases",
  renderReadout,
  ariaLabel,
  animationKey,
  toolbar,
  initiallyHidden = []
}: Props) {
  const idBase = useId().replace(/:/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(initiallyHidden));

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // If the series change and every remaining one was hidden, show them all
  // rather than an empty chart.
  const shown = useMemo(() => {
    const filtered = series.filter(s => !hidden.has(s.key));
    return filtered.length ? filtered : series;
  }, [series, hidden]);
  const showMarkers = markers.length > 0 && !hidden.has(MARKERS_KEY);
  const visible = useMemo(() => new Set(shown.map(s => s.key)), [shown]);

  // Every date any series has, so the crosshair can stop on each one.
  const dates = useMemo(() => [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort(), [series]);
  const lookups = useMemo(() => new Map(series.map(s => [s.key, new Map(s.points.map(p => [p.date, p.value]))])), [series]);

  const margin = { top: 12, right: 12, bottom: 28, left: 64 };
  const plotWidth = Math.max(10, width - margin.left - margin.right);
  const plotHeight = height - margin.top - margin.bottom;

  // The scale follows only the series on screen.
  const values = shown.flatMap(s => s.points.map(p => p.value));
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;
  const low = fromZero ? Math.min(0, rawMin) : rawMin;
  const padding = (rawMax - low) * 0.08 || Math.abs(rawMax) * 0.05 || 1;
  const yMin = fromZero && rawMin >= 0 ? 0 : low - padding;
  const yMax = rawMax + padding;
  const ticks = niceTicks(yMin, yMax).filter(t => t >= yMin && t <= yMax);

  const t0 = dates.length ? time(dates[0]) : 0;
  const t1 = dates.length ? time(dates[dates.length - 1]) : 1;
  const x = (date: string) => margin.left + ((time(date) - t0) / (t1 - t0 || 1)) * plotWidth;
  const y = (value: number) => margin.top + plotHeight - ((value - yMin) / (yMax - yMin || 1)) * plotHeight;

  const xTicks = useMemo(() => {
    if (dates.length < 2) return dates;
    // Few points (e.g. one per year): label every one rather than skip some.
    if (dates.length <= 12 && dates.length * 70 <= plotWidth) return dates;
    const count = Math.max(2, Math.min(6, Math.floor(plotWidth / 120)));
    return Array.from({ length: count }, (_, i) => dates[Math.round((i / (count - 1)) * (dates.length - 1))]);
  }, [dates, plotWidth]);
  const spanDays = (t1 - t0) / 86400000;

  // Last known value of a series on or before `date` (series can have gaps).
  function valueAt(s: TimeSeries, date: string): number | undefined {
    const exact = lookups.get(s.key)?.get(date);
    if (exact !== undefined) return exact;
    let found: number | undefined;
    for (const point of s.points) {
      if (point.date > date) break;
      found = point.value;
    }
    return found;
  }

  function nearestIndex(clientX: number) {
    const rect = wrapRef.current!.getBoundingClientRect();
    const target = t0 + ((clientX - rect.left - margin.left) / plotWidth) * (t1 - t0);
    let lo = 0;
    let hi = dates.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (time(dates[mid]) < target) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(time(dates[lo - 1]) - target) < Math.abs(time(dates[lo]) - target)) lo -= 1;
    return lo;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      setHover(current => {
        const start = current ?? dates.length - 1;
        return Math.max(0, Math.min(dates.length - 1, start + (event.key === "ArrowLeft" ? -step : step)));
      });
    } else if (event.key === "Escape") {
      setHover(null);
    }
  }

  // At least one series always stays visible.
  function toggle(key: string) {
    setHidden(current => {
      // Start from what is on screen, which may be the show-all fallback.
      const next = new Set(series.filter(s => !visible.has(s.key)).map(s => s.key));
      if (current.has(MARKERS_KEY)) next.add(MARKERS_KEY);

      if (next.has(key)) next.delete(key);
      else if (key === MARKERS_KEY || shown.length > 1) next.add(key);
      return next;
    });
  }

  const legendHidden = new Set([...series.filter(s => !visible.has(s.key)).map(s => s.key), ...(showMarkers ? [] : [MARKERS_KEY])]);
  const legend = (
    <ChartLegend
      hidden={legendHidden}
      onToggle={toggle}
      items={[
        ...series.map(s => ({ key: s.key, label: s.label, swatch: s.color })),
        ...(markers.length ? [{ key: MARKERS_KEY, label: markersLabel, swatch: <i className="sw" style={{ background: "var(--series-variable)", borderRadius: "50%" }} /> }] : [])
      ]}
    />
  );

  if (dates.length === 0) {
    return <div style={{ height }} />;
  }

  const hoverDate = hover !== null ? dates[hover] : null;
  const hoverX = hoverDate ? x(hoverDate) : 0;
  const readoutDate = hoverDate ?? dates[dates.length - 1];
  const readoutValues: Record<string, number | undefined> = {};
  shown.forEach(s => { readoutValues[s.key] = valueAt(s, readoutDate); });
  const readoutMarkers = showMarkers ? markers.filter(m => m.date === readoutDate) : [];
  const dateLabel = hoverDate ? fullDate.format(new Date(time(hoverDate))) : "";
  const labelWidth = dateLabel.length * 6.4 + 16;
  const labelX = Math.min(Math.max(hoverX - labelWidth / 2, margin.left), width - margin.right - labelWidth);

  return (
    <div>
      <div className="readout" aria-live="polite">
        {renderReadout({ date: readoutDate, values: readoutValues, markers: readoutMarkers, hovering: hoverDate !== null, visible })}
      </div>
      <div className="chart" ref={wrapRef} style={{ height }}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          onPointerMove={event => setHover(nearestIndex(event.clientX))}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setHover(null)}
          style={{ touchAction: "pan-y", outline: "none" }}
        >
          <defs>
            {shown.filter(s => s.area).map(s => (
              <linearGradient key={s.key} id={`${idBase}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.16" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>

          {ticks.map(tick => (
            <g key={tick}>
              <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 && yMin < 0 ? "var(--ink-3)" : "var(--rule)"} />
              <text x={margin.left - 10} y={y(tick) + 3.5} textAnchor="end">{formatAxis(tick)}</text>
            </g>
          ))}

          {xTicks.map((date, i) => (
            <text
              key={date + i}
              x={x(date)}
              y={height - 8}
              opacity={hoverDate && Math.abs(x(date) - hoverX) < labelWidth / 2 + 30 ? 0 : 1}
              textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
            >
              {(spanDays > 1100 ? yearOnly : spanDays > 120 ? monthYear : dayMonth).format(new Date(time(date)))}
            </text>
          ))}

          <g key={animationKey} className="chart-draw">
            {shown.map(s => {
              const pts = s.points.map(p => [x(p.date), y(p.value)] as [number, number]);
              const d = s.shape === "step" ? stepPath(pts) : s.shape === "line" ? linePath(pts) : smoothPath(pts);
              const base = y(Math.max(yMin, Math.min(0, yMax)));

              return (
                <g key={s.key}>
                  {s.area && pts.length > 1 && (
                    <path className="chart-area" d={`${d}L${pts[pts.length - 1][0]},${base}L${pts[0][0]},${base}Z`} fill={`url(#${idBase}-${s.key})`} />
                  )}
                  <path
                    className="chart-line"
                    d={d}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={s.shape === "step" ? 1.75 : 2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    pathLength={1}
                  />
                </g>
              );
            })}

            {showMarkers && markers.map(marker => (
              <circle
                key={marker.date + marker.label}
                cx={x(marker.date)}
                cy={y(marker.value)}
                r={hoverDate === marker.date ? 5.5 : 4}
                fill="var(--series-variable)"
                stroke="var(--sheet)"
                strokeWidth={2}
                style={{ transition: "r 120ms" }}
              />
            ))}
          </g>

          <line x1={margin.left} x2={width - margin.right} y1={margin.top + plotHeight} y2={margin.top + plotHeight} stroke="var(--ink)" />

          {hoverDate && (
            <g pointerEvents="none">
              <line x1={hoverX} x2={hoverX} y1={margin.top} y2={margin.top + plotHeight} stroke="var(--ink-3)" strokeWidth={1} />
              <rect x={labelX} y={height - 22} width={labelWidth} height={18} rx={4} fill="var(--ink)" />
              <text x={labelX + labelWidth / 2} y={height - 9.5} textAnchor="middle" style={{ fill: "var(--ink-inverse)" }}>{dateLabel}</text>
              {shown.map(s => {
                const value = valueAt(s, hoverDate);
                return value === undefined ? null : (
                  <circle key={s.key} cx={hoverX} cy={y(value)} r={4.5} fill={s.color} stroke="var(--sheet)" strokeWidth={2} />
                );
              })}
            </g>
          )}
        </svg>
      </div>
      <div className="chart-toolbar">
        {legend}
        {toolbar}
      </div>
    </div>
  );
}

// Validated categorical colours for up to five lines (CVD-safe on both themes).
export const LINE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
export const MAX_LINES = LINE_COLORS.length;
