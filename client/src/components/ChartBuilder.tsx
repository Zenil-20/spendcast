import { useMemo, useState, type FormEvent } from "react";
import { Bookmark, X } from "lucide-react";
import { useChartPresets, useFundSeries, useSaveChartPresets } from "../lib/queries";
import { formatDate, formatMoney, formatPercent, signedMoney, tone } from "../lib/format";
import { rangeLabel, TIMELINE_RANGES, trimToRange, type TimelineRange } from "../lib/series";
import { useToast } from "../lib/toast";
import type { ChartMetric, ChartMode, ChartPreset, Holding, TimelinePoint } from "../lib/types";
import { LINE_COLORS, MAX_LINES, TimeChart, type TimeSeries } from "./TimeChart";
import { Button, Segmented, Skeleton } from "./ui";

/*
 * Build a chart from any of the person's own funds: each fund as its own line
 * (up to five, the most the palette keeps distinguishable) or all of them
 * added together, for value, money put in, gain or return. Charts can be saved
 * and reopened. Only funds the person holds can be picked.
 */

const inr = (value: number, style: "full" | "whole" | "compact" = "whole") => formatMoney(value, "INR", style);

const METRICS: Record<ChartMetric, {
  label: string;
  pick: (point: TimelinePoint) => number | null;
  format: (value: number) => string;
  axis: (value: number) => string;
  fromZero: boolean;
  // Value and invested jump on purchase days, so they're drawn as steps; gain
  // and return don't, so they're plain lines.
  shape: "step" | "line";
}> = {
  value: { label: "Current value", pick: p => p.value, format: v => inr(v), axis: v => inr(v, "compact"), fromZero: true, shape: "step" },
  invested: { label: "Invested", pick: p => p.invested, format: v => inr(v), axis: v => inr(v, "compact"), fromZero: true, shape: "step" },
  gain: { label: "Gain", pick: p => p.value - p.invested, format: v => signedMoney(v, "INR"), axis: v => inr(v, "compact"), fromZero: true, shape: "line" },
  returnPercent: {
    label: "Return %",
    pick: p => (p.invested > 0 ? p.value / p.invested - 1 : null),
    format: v => formatPercent(v),
    axis: v => formatPercent(v, { sign: false, digits: 0 }),
    fromZero: true,
    shape: "line"
  }
};

const METRIC_KEYS = Object.keys(METRICS) as ChartMetric[];
const MAX_PRESETS = 12;
const COMBINED_KEY = "combined";

function toLine(points: TimelinePoint[], metric: ChartMetric) {
  const pick = METRICS[metric].pick;
  return points.flatMap(point => {
    const value = pick(point);
    return value === null ? [] : [{ date: point.date, value }];
  });
}

export function ChartBuilder({ holdings }: { holdings: Holding[] }) {
  const byValue = useMemo(() => [...holdings].sort((a, b) => b.value - a.value), [holdings]);
  const held = useMemo(() => new Map(holdings.map(h => [h.schemeCode, h])), [holdings]);

  const [selected, setSelected] = useState<number[]>(() => byValue.slice(0, Math.min(3, MAX_LINES)).map(h => h.schemeCode));
  const [metric, setMetric] = useState<ChartMetric>("returnPercent");
  const [mode, setMode] = useState<ChartMode>("separate");
  const [range, setRange] = useState<TimelineRange>("1Y");

  // Funds sold since a chart was saved simply drop out of it.
  const codes = useMemo(() => selected.filter(code => held.has(code)), [selected, held]);
  const tooMany = mode === "separate" && codes.length > MAX_LINES;
  const effectiveMode: ChartMode = tooMany ? "combined" : mode;
  const query = useFundSeries(codes);

  function toggleFund(code: number) {
    setSelected(current => (current.includes(code) ? current.filter(c => c !== code) : [...current, code]));
  }

  const series = useMemo<TimeSeries[]>(() => {
    const data = query.data;
    if (!data || !codes.length) return [];

    if (effectiveMode === "combined") {
      const points = trimToRange(data.combined, range);
      const label = codes.length === 1 ? held.get(codes[0])!.shortName : `${codes.length} funds together`;
      const lines: TimeSeries[] = [{ key: COMBINED_KEY, label, color: "var(--series-recurring)", shape: METRICS[metric].shape, area: true, points: toLine(points, metric) }];
      // Value reads best against the money put in, as on the summary chart.
      if (metric === "value") {
        lines.push({ key: "combined-invested", label: "Invested", color: "var(--series-variable)", shape: "step", points: toLine(points, "invested") });
      }
      return lines;
    }

    // Same end date for every fund, so ranges line up.
    const end = data.combined[data.combined.length - 1]?.date;
    return codes.flatMap((code, index) => {
      const fund = data.funds.find(f => f.schemeCode === code);
      if (!fund) return [];
      return [{
        key: String(code),
        label: fund.shortName,
        color: LINE_COLORS[index % LINE_COLORS.length],
        shape: METRICS[metric].shape,
        points: toLine(trimToRange(fund.points, range, end), metric)
      }];
    });
  }, [query.data, codes, effectiveMode, metric, range, held]);

  const config = METRICS[metric];
  const colorOf = new Map(series.map(s => [s.key, s.color]));
  const labelOf = new Map(series.map(s => [s.key, s.label]));
  const waiting = codes.length > 0 && (query.isPending || (query.isPlaceholderData && series.length === 0));

  return (
    <div className="builder">
      <div className="builder-controls">
        <div className="builder-group">
          <div className="row between" style={{ gap: 12 }}>
            <span className="eyebrow">Funds · {codes.length} of {holdings.length}</span>
            <span className="row" style={{ gap: 4 }}>
              <button type="button" className="btn btn-link small" onClick={() => setSelected(byValue.map(h => h.schemeCode))} disabled={codes.length === holdings.length}>All</button>
              <span className="ink-3">·</span>
              <button type="button" className="btn btn-link small" onClick={() => setSelected([])} disabled={codes.length === 0}>Clear</button>
            </span>
          </div>
          <div className="fund-chips" role="group" aria-label="Funds in the chart">
            {byValue.map(holding => {
              const on = codes.includes(holding.schemeCode);
              const color = on && effectiveMode === "separate" ? colorOf.get(String(holding.schemeCode)) : undefined;
              return (
                <button key={holding.schemeCode} type="button" className="fund-chip" aria-pressed={on} onClick={() => toggleFund(holding.schemeCode)} title={holding.schemeName}>
                  <i style={color ? { background: color } : undefined} />
                  <span>{holding.shortName}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="builder-row">
          <label className="builder-field">
            <span className="eyebrow">Show</span>
            <select className="select compact" value={metric} onChange={event => setMetric(event.target.value as ChartMetric)}>
              {METRIC_KEYS.map(key => <option key={key} value={key}>{METRICS[key].label}</option>)}
            </select>
          </label>
          <div className="builder-field">
            <span className="eyebrow">Draw as</span>
            <Segmented<ChartMode>
              label="Draw as"
              value={effectiveMode}
              onChange={setMode}
              options={[{ value: "separate", label: "Line per fund" }, { value: "combined", label: "Added together" }]}
            />
          </div>
          <SavePreset selected={codes} metric={metric} mode={effectiveMode} />
        </div>
        {tooMany && (
          <p className="small ink-3">
            {codes.length} funds are added together — separate lines stay readable up to {MAX_LINES}. Deselect {codes.length - MAX_LINES} to compare them one by one.
          </p>
        )}
        <SavedCharts held={held} onOpen={preset => { setSelected(preset.schemeCodes); setMetric(preset.metric); setMode(preset.mode); }} />
      </div>

      <section className="summary-card" style={{ paddingBottom: 14 }} aria-label="Custom chart">
        {codes.length === 0 && (
          <div className="builder-empty">
            <div style={{ fontWeight: 600 }}>Pick at least one fund</div>
            <div className="small ink-3" style={{ marginTop: 4 }}>Choose any of your funds above to chart them.</div>
          </div>
        )}
        {waiting && <Skeleton height={330} />}
        {query.isError && codes.length > 0 && <div className="notice error" role="alert">{query.error.message}</div>}
        {!waiting && series.length > 0 && (
          <TimeChart
            // Remount when the set of lines changes, so hidden lines reset.
            key={`${effectiveMode}|${metric}|${codes.join(",")}`}
            ariaLabel={`${config.label} of ${series.map(s => s.label).join(", ")}`}
            animationKey={range}
            height={300}
            fromZero={config.fromZero}
            series={series}
            formatAxis={config.axis}
            toolbar={
              <div className="row" style={{ gap: 10 }}>
                {query.isFetching && <span className="spinner ink-3" aria-label="Updating" />}
                <Segmented<TimelineRange> label="Chart range" value={range} onChange={setRange} options={TIMELINE_RANGES.map(value => ({ value, label: rangeLabel(value) }))} />
              </div>
            }
            renderReadout={({ date, values, hovering }) => {
              const rows = Object.entries(values)
                .filter((entry): entry is [string, number] => entry[1] !== undefined)
                // Rank funds against each other; a combined chart keeps its own order.
                .sort((a, b) => (effectiveMode === "separate" ? b[1] - a[1] : 0));
              return (
                <>
                  <span className="r-date">
                    {hovering ? formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : `Latest · ${formatDate(date, { day: "numeric", month: "short", year: "numeric" })}`}
                  </span>
                  {rows.map(([key, value]) => (
                    <span className="r-item" key={key}>
                      <i style={{ background: colorOf.get(key) }} />{labelOf.get(key)}{" "}
                      <b className={metric === "gain" || metric === "returnPercent" ? tone(value) : ""}>{config.format(value)}</b>
                    </span>
                  ))}
                </>
              );
            }}
          />
        )}
      </section>
    </div>
  );
}

function SavePreset({ selected, metric, mode }: { selected: number[]; metric: ChartMetric; mode: ChartMode }) {
  const presets = useChartPresets();
  const save = useSaveChartPresets();
  const toast = useToast();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const list = presets.data ?? [];
  const full = list.length >= MAX_PRESETS;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = list.find(preset => preset.name.toLowerCase() === trimmed.toLowerCase());
    const preset: ChartPreset = { id: existing?.id ?? crypto.randomUUID(), name: trimmed, schemeCodes: selected, metric, mode };
    const next = existing ? list.map(item => (item.id === existing.id ? preset : item)) : [...list, preset];

    try {
      await save.mutateAsync(next);
      toast.success(existing ? `Updated "${trimmed}"` : `Saved "${trimmed}"`);
      setNaming(false);
      setName("");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  if (!naming) {
    return (
      <div className="builder-field" style={{ marginLeft: "auto" }}>
        <span className="eyebrow" aria-hidden="true">&nbsp;</span>
        <Button
          variant="secondary"
          icon={<Bookmark size={14} />}
          disabled={selected.length === 0 || presets.isPending || full}
          title={full ? `You can keep up to ${MAX_PRESETS} saved charts. Delete one to save another.` : undefined}
          onClick={() => setNaming(true)}
        >
          Save chart
        </Button>
      </div>
    );
  }

  return (
    <form className="builder-field save-form" onSubmit={submit} style={{ marginLeft: "auto" }}>
      <label className="eyebrow" htmlFor="preset-name">Name this chart</label>
      <div className="row" style={{ gap: 6 }}>
        <input
          id="preset-name"
          className="input compact"
          value={name}
          maxLength={40}
          autoFocus
          placeholder="e.g. Small caps"
          onChange={event => setName(event.target.value)}
          onKeyDown={event => { if (event.key === "Escape") setNaming(false); }}
        />
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!name.trim()}>Save</Button>
        <Button type="button" variant="ghost" onClick={() => setNaming(false)}>Cancel</Button>
      </div>
    </form>
  );
}

function SavedCharts({ held, onOpen }: { held: Map<number, Holding>; onOpen: (preset: ChartPreset) => void }) {
  const presets = useChartPresets();
  const save = useSaveChartPresets();
  const toast = useToast();
  const list = presets.data ?? [];

  if (!list.length) return null;

  async function remove(preset: ChartPreset) {
    try {
      await save.mutateAsync(list.filter(item => item.id !== preset.id));
      toast.success(`Deleted "${preset.name}"`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <div className="builder-group">
      <span className="eyebrow">Saved charts</span>
      <div className="fund-chips">
        {list.map(preset => {
          const available = preset.schemeCodes.filter(code => held.has(code)).length;
          return (
            <span key={preset.id} className="preset-chip">
              <button
                type="button"
                disabled={available === 0}
                title={available === 0 ? "You no longer hold any of these funds" : `${available} fund${available === 1 ? "" : "s"} · ${METRICS[preset.metric].label}`}
                onClick={() => onOpen(preset)}
              >
                {preset.name}
              </button>
              <button type="button" className="x" aria-label={`Delete saved chart ${preset.name}`} disabled={save.isPending} onClick={() => remove(preset)}>
                <X size={12} />
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
