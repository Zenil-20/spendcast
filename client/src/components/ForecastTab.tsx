import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useProjection } from "../lib/queries";
import { useDebounced } from "../lib/hooks";
import { formatDate, formatMoney, formatPercent, signedMoney } from "../lib/format";
import type { Projection } from "../lib/types";
import { TimeChart } from "./TimeChart";
import { Button, Skeleton } from "./ui";

/*
 * Where the portfolio could be in 3, 6, 12 and 36 months, as a range from
 * replaying real market history with the SIPs actually scheduled. The slider
 * changes the monthly SIP so the whole range can be seen to move, instead of
 * one predicted number.
 */

const inr = (value: number, style: "whole" | "compact" = "whole") => formatMoney(value, "INR", style);
const horizonLabel = (months: number) => (months < 12 ? `${months} months` : months === 12 ? "1 year" : `${months / 12} years`);

export function ForecastTab() {
  const [extra, setExtra] = useState(0);
  const debounced = useDebounced(extra, 250);
  const query = useProjection(debounced);
  // The slider's range comes from the current plan, which `extra` doesn't change.
  const base = useProjection(0);

  if (base.isPending) return <Skeleton height={360} />;
  if (base.isError) return <div className="notice error" role="alert"><AlertTriangle size={16} /><div>{base.error.message}</div></div>;
  if (!base.data.projection) return <p className="small ink-3">{base.data.reason}</p>;

  const current = base.data.projection.currentMonthly;
  const projection = query.data?.projection ?? base.data.projection;
  const max = Math.max(25000, Math.ceil((current * 2) / 1000) * 1000);

  return (
    <div className="stack" style={{ gap: 24 }}>
      <section className="card" aria-label="Monthly SIP">
        <div className="row between wrap" style={{ gap: 12 }}>
          <div>
            <h3>Monthly SIP</h3>
            <div className="sub" style={{ marginBottom: 0 }}>
              {current > 0 ? `Your SIPs total ${inr(current)} a month. Move the slider to see the range change.` : "You have no active SIPs. Add a monthly amount to see what it could grow to."}
            </div>
          </div>
          <div className="sip-readout">
            <span className="mono">{inr(current + extra)}</span>
            {extra !== 0 && <span className={extra > 0 ? "up" : "down"}>{signedMoney(extra, "INR")}</span>}
            {extra !== 0 && <Button variant="ghost" size="sm" onClick={() => setExtra(0)}>Reset</Button>}
          </div>
        </div>
        <input
          type="range"
          className="sip-slider"
          aria-label="Change to monthly SIP"
          min={-current}
          max={max}
          step={500}
          value={extra}
          onChange={event => setExtra(Number(event.target.value))}
        />
        <div className="row between small ink-3"><span>{current > 0 ? "Stop SIPs" : "₹0"}</span><span>+{inr(max)}</span></div>
      </section>

      <div className={`horizon-grid ${query.isFetching ? "refreshing" : ""}`}>
        {projection.horizons.map(horizon => (
          <section className="card horizon-card" key={horizon.months} aria-label={`In ${horizonLabel(horizon.months)}`}>
            <div className="eyebrow">In {horizonLabel(horizon.months)} · {formatDate(horizon.date, { month: "short", year: "numeric" })}</div>
            <div className="horizon-baseline">{inr(horizon.baseline, "compact")}</div>
            <div className="small ink-3">typical (baseline)</div>
            <dl className="kv-list" style={{ marginTop: 12 }}>
              <dt>Optimistic <span className="ink-3">(top 10%)</span></dt><dd>{inr(horizon.optimistic, "compact")}</dd>
              <dt>Pessimistic <span className="ink-3">(bottom 10%)</span></dt><dd>{inr(horizon.pessimistic, "compact")}</dd>
              <dt>Middle half</dt><dd>{inr(horizon.p25, "compact")}–{inr(horizon.p75, "compact")}</dd>
              <dt className="total">You'll have put in</dt><dd className="total">{inr(horizon.invested, "compact")}</dd>
              <dt>Chance of being below that</dt><dd>{formatPercent(horizon.lossProbability, { sign: false, digits: 0 })}</dd>
            </dl>
          </section>
        ))}
      </div>

      <FanChart projection={projection} />
      <Sensitivity projection={base.data.projection} onPick={monthly => setExtra(monthly - current)} selected={current + extra} />
      <Assumptions projection={projection} benchmarkName={base.data.benchmarkName ?? null} />
    </div>
  );
}

function FanChart({ projection }: { projection: Projection }) {
  const series = useMemo(() => [
    { key: "median", label: "Baseline", color: "var(--series-recurring)", shape: "smooth" as const, area: true, points: projection.fan.map(p => ({ date: p.date, value: p.median })) },
    { key: "p90", label: "Optimistic (top 10%)", color: "var(--chart-3)", shape: "smooth" as const, points: projection.fan.map(p => ({ date: p.date, value: p.p90 })) },
    { key: "p10", label: "Pessimistic (bottom 10%)", color: "var(--chart-2)", shape: "smooth" as const, points: projection.fan.map(p => ({ date: p.date, value: p.p10 })) }
  ], [projection]);

  return (
    <section className="card" aria-label="Forecast range over time">
      <h3>The range, month by month</h3>
      <div className="sub">8 in 10 replays of past markets ended between the pessimistic and optimistic lines.</div>
      <TimeChart
        ariaLabel="Forecast portfolio value: baseline, optimistic and pessimistic over the next 3 years"
        height={260}
        fromZero
        series={series}
        formatAxis={value => inr(value, "compact")}
        renderReadout={({ date, values }) => (
          <>
            <span className="r-date">{formatDate(date, { month: "short", year: "numeric" })}</span>
            {series.filter(s => values[s.key] !== undefined).map(s => (
              <span className="r-item" key={s.key}><i style={{ background: s.color }} />{s.label} <b>{inr(values[s.key]!, "compact")}</b></span>
            ))}
          </>
        )}
      />
    </section>
  );
}

function Sensitivity({ projection, onPick, selected }: { projection: Projection; onPick: (monthly: number) => void; selected: number }) {
  return (
    <section className="card" aria-label="Different monthly amounts">
      <h3>In {horizonLabel(projection.sensitivity.months)}, at different monthly amounts</h3>
      <div className="sub">The same replays of past markets; only the SIP changes. Pick a row to try it above.</div>
      <div className="table-scroll">
        <table className="ledger compact">
          <thead><tr><th>Monthly SIP</th><th className="num">Pessimistic</th><th className="num">Baseline</th><th className="num">Optimistic</th><th /></tr></thead>
          <tbody>
            {projection.sensitivity.rows.map(row => (
              <tr key={row.monthly} className={row.monthly === selected ? "selected-row" : ""}>
                <td className="mono">{inr(row.monthly)}{row.change === 0 && <span className="ink-3 small"> · now</span>}</td>
                <td className="num">{inr(row.pessimistic, "compact")}</td>
                <td className="num">{inr(row.baseline, "compact")}</td>
                <td className="num">{inr(row.optimistic, "compact")}</td>
                <td className="num"><Button variant="ghost" size="sm" onClick={() => onPick(row.monthly)}>Try</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Assumptions({ projection, benchmarkName }: { projection: Projection; benchmarkName: string | null }) {
  const { assumptions } = projection;
  const borrowed = assumptions.funds.filter(fund => fund.borrowedMonths > assumptions.history.months * 0.1);
  const missing = assumptions.funds.filter(fund => fund.missRate > 0);

  return (
    <section className="card" aria-label="Assumptions">
      <h3>How this is worked out</h3>
      <ul className="evidence-list">
        <li>
          {assumptions.history.paths.toLocaleString("en-IN")} replays of real monthly returns from {formatDate(`${assumptions.history.from}-01`, { month: "short", year: "numeric" })} to {formatDate(`${assumptions.history.to}-01`, { month: "short", year: "numeric" })},
          picked in {assumptions.history.blockMonths}-month stretches so crashes and recoveries stay intact. Every fund takes its return from the same past month, so funds that fell together fall together here.
        </li>
        <li>Upcoming SIP installments follow each SIP's own date{assumptions.stepUpsIncluded ? ", yearly step-up" : ""} and end date, paid at the {assumptions.contributionTiming}.</li>
        {missing.length > 0
          ? <li>Missed installments: {missing.map(fund => `${fund.shortName} ${fund.missed} of ${fund.scheduled} in the last 2 years`).join("; ")}. Each future installment can be missed at that same rate.</li>
          : <li>You haven't marked any installment as missed in the last 2 years, so every future installment is assumed to go through.</li>}
        {borrowed.length > 0 && (
          <li>
            {borrowed.map(fund => fund.shortName).join(", ")} {borrowed.length === 1 ? "is" : "are"} newer than that history, so {benchmarkName ?? "the Nifty 50"}'s returns stand in for the months before {borrowed.length === 1 ? "it" : "they"} existed.
          </li>
        )}
        <li>Leaves out {assumptions.excludes.join(", ")}.</li>
      </ul>
      <p className="disclaimer" style={{ marginTop: 10 }}>Past markets don't guarantee future ones; these are ranges, not promises. Not investment advice.</p>
    </section>
  );
}
