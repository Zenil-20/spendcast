import type { SipDateStudy } from "../lib/types";
import { formatDate, formatMoney, formatPercent, ordinal } from "../lib/format";

const inr = (value: number) => formatMoney(value, "INR", "whole");

// Below this, the SIP date made no practical difference.
const NEGLIGIBLE = 0.01;

// The same monthly SIP run on every date 1st-28th over the fund's last five
// years: how much the date actually changed the result.
export function SipDateCard({ study, sipDays }: { study: SipDateStudy; sipDays: number[] }) {
  const byDay = new Map(study.days.map(item => [item.day, item]));
  const best = byDay.get(study.best)!;
  const worst = byDay.get(study.worst)!;
  // Each day's shortfall against the best day, as a share of the best result.
  const gapOf = (value: number) => 1 - value / best.value;
  const maxGap = Math.max(gapOf(worst.value), 1e-9);
  const yours = [...new Set(sipDays.map(day => Math.min(day, 28)))].sort((a, b) => a - b);
  const years = Math.round(study.months / 12);

  return (
    <div className="card sip-date">
      <h3>Does your SIP date matter?</h3>
      <div className="sub">
        A {inr(study.amount)} monthly SIP in this fund, run on each date of the month for the last {years} years
        ({formatDate(study.from, { month: "short", year: "numeric" })} – {formatDate(study.to, { month: "short", year: "numeric" })}).
      </div>

      <p className="sip-date-verdict">
        {maxGap < NEGLIGIBLE
          ? <>Hardly at all. Even the worst date ({ordinal(study.worst)}) ended just {formatPercent(maxGap, { sign: false, digits: 2 })} behind the best ({ordinal(study.best)}).</>
          : <>A little. The worst date ({ordinal(study.worst)}) ended {formatPercent(maxGap, { sign: false, digits: 2 })} behind the best ({ordinal(study.best)}).</>}
        {" "}Pick the date that suits your salary — staying invested matters far more.
      </p>

      <div className="sip-date-chart" role="img" aria-label={`Final value by SIP date. Best: ${ordinal(study.best)}; worst: ${ordinal(study.worst)}, ${formatPercent(maxGap, { sign: false, digits: 2 })} behind.`}>
        <div className="axis">
          <span>best</span>
          <span>−{formatPercent(maxGap, { sign: false, digits: 2 })}</span>
        </div>
        <div className="bars">
          {study.days.map(item => {
            const gap = gapOf(item.value);
            const mine = yours.includes(item.day);
            return (
              <div
                key={item.day}
                className={`bar${mine ? " mine" : ""}${item.day === study.best ? " best" : ""}`}
                title={`${ordinal(item.day)}: ${inr(item.value)}${gap > 0 ? ` (${formatPercent(-gap, { digits: 2 })} vs best)` : " — best"}`}
              >
                <span style={{ height: `${Math.max(2, (gap / maxGap) * 100)}%` }} />
                <em>{mine || ((item.day === 1 || item.day % 7 === 0) && !yours.some(day => Math.abs(day - item.day) === 1)) ? item.day : ""}</em>
              </div>
            );
          })}
        </div>
      </div>
      <div className="small ink-3" style={{ marginTop: 6 }}>
        Bars hang down by how far each date fell short of the best. The scale is stretched: the whole chart spans only
        {" "}{formatPercent(maxGap, { sign: false, digits: 2 })}.
      </div>

      {yours.length > 0 && (
        <dl className="kv-list" style={{ marginTop: 14 }}>
          {yours.map(day => {
            const item = byDay.get(day)!;
            const gap = gapOf(item.value);
            return (
              <div key={day} style={{ display: "contents" }}>
                <dt>Your date, the {ordinal(day)}</dt>
                <dd>{inr(item.value)} · {gap < 0.0001 ? "the best date" : `${formatPercent(gap, { sign: false, digits: 2 })} behind the best`}</dd>
              </div>
            );
          })}
          <dt>Best date, the {ordinal(study.best)}</dt>
          <dd>{inr(best.value)}{best.xirr !== null && ` · XIRR ${formatPercent(best.xirr, { digits: 1 })}`}</dd>
          <dt>Worst date, the {ordinal(study.worst)}</dt>
          <dd>{inr(worst.value)}{worst.xirr !== null && ` · XIRR ${formatPercent(worst.xirr, { digits: 1 })}`}</dd>
        </dl>
      )}
      <p className="disclaimer" style={{ marginTop: 10 }}>
        Same {study.months} installments of {inr(study.amount)} ({inr(study.invested)}) for every date, each at the next trading day's NAV after
        stamp duty. A past pattern like "the 1st was best" isn't stable and shouldn't be relied on.
      </p>
    </div>
  );
}
