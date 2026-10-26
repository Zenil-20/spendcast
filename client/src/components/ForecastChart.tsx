import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { BudgetStatus, Forecast, Range } from "../lib/types";
import { formatMoney } from "../lib/format";
import { StatusBadge } from "./ui";
import { ChartLegend, type LegendItem } from "./ChartLegend";

export interface Column {
  kind: "Actual" | "This month" | "Forecast";
  label: string;
  month: number;
  recurring: number;
  variable: number;
  projectedRecurring: number;
  projectedVariable: number;
  total: number;
  spent?: number;
  range?: Range;
  status?: BudgetStatus;
}

// One column per month: the last 12 months, this month, then the forecast.
export function buildColumns(data: Forecast): Column[] {
  const history: Column[] = data.monthlyHistory.slice(-12).map(m => ({
    kind: "Actual",
    label: m.monthLabel,
    month: m.month,
    recurring: m.recurringExpenditure,
    variable: m.variableExpenditure,
    projectedRecurring: 0,
    projectedVariable: 0,
    total: m.totalExpenditure
  }));

  const c = data.currentMonth!;
  const current: Column = {
    kind: "This month",
    label: c.monthLabel,
    month: c.month,
    recurring: c.recurringSpentSoFar,
    variable: c.variableSpentSoFar,
    projectedRecurring: c.upcomingRecurringExpenditure,
    projectedVariable: c.expectedRemainingVariableExpenditure,
    total: c.projectedTotalExpenditure,
    spent: c.spentSoFar,
    range: c.projectedTotalRange,
    status: c.budgetStatus
  };

  const forecast: Column[] = (data.forecast ?? []).map(m => ({
    kind: "Forecast",
    label: m.monthLabel,
    month: m.month,
    recurring: 0,
    variable: 0,
    projectedRecurring: m.expectedRecurringExpenditure,
    projectedVariable: m.estimatedVariableExpenditure,
    total: m.estimatedTotalExpenditure,
    range: m.estimatedTotalRange,
    status: m.budgetStatus
  }));

  return [...history, current, ...forecast];
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exponent = Math.pow(10, Math.floor(Math.log10(value)));
  const fraction = value / exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * exponent;
}

// Column with a 3px rounded top and a square base.
function columnPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, height, width / 2);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

type LayerKey = "recurring" | "variable" | "forecast" | "range" | "budget";

const HEIGHT = 300;
const GAP = 2;

export function ForecastChart({ data }: { data: Forecast }) {
  const patternId = useId().replace(/:/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [hover, setHover] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<LayerKey>>(() => new Set());
  const columns = useMemo(() => buildColumns(data), [data]);
  const currency = data.currency;
  const budgetValue = data.currentMonth?.budget ?? null;
  const on = (key: LayerKey) => !hidden.has(key);
  const budget = on("budget") ? budgetValue : null;
  // The likely range is for the whole total, so it only fits a complete stack.
  const rangeFits = on("recurring") && on("variable") && on("forecast");
  const showRange = rangeFits && on("range");

  // Bills or everyday spending always stays on, so the chart is never empty.
  function toggle(key: string) {
    setHidden(current => {
      const next = new Set(current);
      const layer = key as LayerKey;
      if (next.has(layer)) next.delete(layer);
      else if (!((layer === "recurring" && next.has("variable")) || (layer === "variable" && next.has("recurring")))) next.add(layer);
      return next;
    });
  }

  const legendItems: LegendItem[] = [
    { key: "recurring", label: "Bills", swatch: "var(--series-recurring)" },
    { key: "variable", label: "Everyday spending", swatch: "var(--series-variable)" },
    { key: "forecast", label: "Forecast", swatch: <i className="sw hatch" /> },
    { key: "range", label: "Likely range", swatch: <i className="wh" />, unavailable: rangeFits ? undefined : "The likely range covers the full total — turn every part back on to see it" },
    ...(budgetValue !== null ? [{ key: "budget", label: "Budget", swatch: <i className="ln" /> }] : [])
  ];

  // What each column draws, given the layers that are on.
  const stack = (column: Column) => [
    { value: on("recurring") ? column.recurring : 0, fill: "var(--series-recurring)" },
    { value: on("variable") ? column.variable : 0, fill: "var(--series-variable)" },
    { value: on("recurring") && on("forecast") ? column.projectedRecurring : 0, fill: `url(#${patternId}-recurring)`, stroke: "var(--series-recurring)" },
    { value: on("variable") && on("forecast") ? column.projectedVariable : 0, fill: `url(#${patternId}-variable)`, stroke: "var(--series-variable)" }
  ].filter(segment => segment.value > 0);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const chartWidth = Math.max(width, columns.length * 30 + 120);
  const margin = { top: 28, right: budget !== null ? 76 : 8, bottom: 38, left: 48 };
  const plotWidth = chartWidth - margin.left - margin.right;
  const plotHeight = HEIGHT - margin.top - margin.bottom;
  // The scale follows what is on screen.
  const peak = Math.max(budget ?? 0, ...columns.map(c => Math.max(stack(c).reduce((sum, s) => sum + s.value, 0), showRange ? c.range?.high ?? 0 : 0)));
  const yMax = niceMax(peak * 1.04);
  const y = (value: number) => margin.top + plotHeight - (value / yMax) * plotHeight;
  const slot = plotWidth / columns.length;
  const barWidth = Math.min(22, slot * 0.56);
  const splitIndex = columns.findIndex(c => c.kind !== "Actual");
  const splitX = margin.left + splitIndex * slot;
  // The readout shows the hovered month, or this month when not hovering.
  const shown = columns[hover ?? splitIndex] ?? columns[columns.length - 1];

  return (
    <figure>
      <Readout column={shown} currency={currency} hovering={hover !== null} />
      <ChartLegend items={legendItems} hidden={hidden} onToggle={toggle} style={{ marginBottom: 14 }} />

      <div className="chart" ref={wrapRef} style={{ overflowX: chartWidth > width + 1 ? "auto" : "visible" }}>
        <svg width={chartWidth} height={HEIGHT} role="img" aria-label="Monthly spending: the last 12 months, this month, and the forecast">
          <defs>
            {(["recurring", "variable"] as const).map(series => (
              <pattern key={series} id={`${patternId}-${series}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="4" height="4" fill={`var(--series-${series})`} fillOpacity="0.14" />
                <line x1="0" y1="0" x2="0" y2="4" stroke={`var(--series-${series})`} strokeWidth="1.6" />
              </pattern>
            ))}
          </defs>

          {/* Divider between what happened and what's expected */}
          <line x1={splitX} x2={splitX} y1={margin.top - 18} y2={margin.top + plotHeight} stroke="var(--rule-strong)" />
          <text x={splitX - 8} y={margin.top - 8} textAnchor="end">Actual</text>
          <text x={splitX + 8} y={margin.top - 8}>Forecast</text>

          {[0, 1, 2, 3, 4].map(i => {
            const value = (yMax / 4) * i;
            return (
              <g key={i}>
                <line x1={margin.left} x2={chartWidth - margin.right} y1={y(value)} y2={y(value)} stroke={i === 0 ? "var(--ink)" : "var(--rule)"} strokeWidth={i === 0 ? 1 : 1} />
                <text x={margin.left - 10} y={y(value) + 3.5} textAnchor="end">{formatMoney(value, currency, "compact")}</text>
              </g>
            );
          })}

          {columns.map((column, index) => {
            const x = margin.left + index * slot + (slot - barWidth) / 2;
            const center = x + barWidth / 2;
            const segments = stack(column);

            let base = 0;
            const [monthShort, year] = column.label.split(" ");
            const dim = hover !== null && hover !== index;

            return (
              <g key={column.label + column.kind} style={{ opacity: dim ? 0.45 : 1, transition: "opacity 120ms" }}>
                {segments.map((segment, segmentIndex) => {
                  const top = y(base + segment.value);
                  const bottom = y(base) - (segmentIndex > 0 ? GAP : 0);
                  const height = Math.max(0, bottom - top);
                  const isTop = segmentIndex === segments.length - 1;
                  base += segment.value;

                  return (
                    <path
                      key={segmentIndex}
                      d={isTop ? columnPath(x, top, barWidth, height, 3) : `M${x},${top}h${barWidth}v${height}h${-barWidth}Z`}
                      fill={segment.fill}
                      stroke={segment.stroke}
                      strokeWidth={segment.stroke ? 1 : 0}
                    />
                  );
                })}

                {showRange && column.range && (
                  <g stroke="var(--ink-2)" strokeWidth={1.25} strokeLinecap="round">
                    <line x1={center} x2={center} y1={y(column.range.high)} y2={y(column.range.low)} />
                    <line x1={center - 4} x2={center + 4} y1={y(column.range.high)} y2={y(column.range.high)} />
                    <line x1={center - 4} x2={center + 4} y1={y(column.range.low)} y2={y(column.range.low)} />
                  </g>
                )}

                <text x={center} y={HEIGHT - margin.bottom + 17} textAnchor="middle" style={column.kind === "This month" ? { fill: "var(--ink)", fontWeight: 600 } : undefined}>
                  {monthShort}
                </text>
                {(column.month === 1 || index === 0) && (
                  <text x={center} y={HEIGHT - margin.bottom + 31} textAnchor="middle">{year}</text>
                )}

                <rect
                  className="hit"
                  x={margin.left + index * slot}
                  y={margin.top}
                  width={slot}
                  height={plotHeight}
                  tabIndex={0}
                  aria-label={`${column.label}, ${column.kind.toLowerCase()}: ${formatMoney(column.total, currency)}`}
                  onPointerEnter={() => setHover(index)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(index)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}

          {budget !== null && (
            <g pointerEvents="none">
              <line x1={margin.left} x2={chartWidth - margin.right + 4} y1={y(budget)} y2={y(budget)} stroke="var(--ink)" strokeWidth={1} />
              <text x={chartWidth - margin.right + 10} y={y(budget) - 3} style={{ fill: "var(--ink)" }}>Budget</text>
              <text x={chartWidth - margin.right + 10} y={y(budget) + 10}>{formatMoney(budget, currency, "compact")}</text>
            </g>
          )}
        </svg>

      </div>
    </figure>
  );
}

function Readout({ column, currency, hovering }: { column: Column; currency: string; hovering: boolean }) {
  const item = (label: string, value: number, color?: string) => (
    <span className="r-item" key={label}>
      {color && <i style={{ background: color }} />}{label} <b>{formatMoney(value, currency, "whole")}</b>
    </span>
  );
  const kind = column.kind === "Actual" ? "Spent" : column.kind === "This month" ? "So far + still expected" : "Forecast";

  return (
    <div className="readout" aria-live="polite">
      <span className="r-date">{column.label} · {kind}{!hovering && " · hover a month for details"}</span>
      {column.kind === "Actual" && [
        item("Bills", column.recurring, "var(--series-recurring)"),
        item("Everyday", column.variable, "var(--series-variable)")
      ]}
      {column.kind === "This month" && [
        item("Spent", column.spent ?? 0),
        item("Bills due", column.projectedRecurring, "var(--series-recurring)"),
        item("Still expected", column.projectedVariable, "var(--series-variable)")
      ]}
      {column.kind === "Forecast" && [
        item("Bills", column.projectedRecurring, "var(--series-recurring)"),
        item("Everyday", column.projectedVariable, "var(--series-variable)")
      ]}
      {item("Total", column.total)}
      {column.range && (
        <span className="r-item">Likely <b>{formatMoney(column.range.low, currency, "compact")}–{formatMoney(column.range.high, currency, "compact")}</b></span>
      )}
      {column.status && <StatusBadge status={column.status} />}
    </div>
  );
}
