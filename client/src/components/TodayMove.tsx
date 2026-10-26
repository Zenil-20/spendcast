import type { TodayMove as Move } from "../lib/types";
import { formatDate, formatMoney, formatPercent, signedMoney, tone } from "../lib/format";
import { DivergingBars } from "./DivergingBars";

const inr = (value: number) => formatMoney(value, "INR", "whole");

// One sentence on the portfolio against the market that day.
function versusMarket(percent: number | null, market: number | null): string | null {
  if (percent === null || market === null) return null;
  const gap = Math.abs(percent - market);
  if (gap < 0.001) return "in line with the Nifty 50";
  if (percent < 0 && market < 0) return percent < market ? "a bigger fall than the Nifty 50" : "a smaller fall than the Nifty 50";
  if (percent > 0 && market > 0) return percent > market ? "ahead of the Nifty 50" : "behind the Nifty 50";
  return percent > market ? "while the Nifty 50 fell" : "while the Nifty 50 rose";
}

// Why the portfolio moved on the latest trading day, fund by fund.
export function TodayMoveCard({ move }: { move: Move }) {
  const lead = move.movers[0];
  const sameDirection = move.movers.filter(item => Math.sign(item.change) === Math.sign(move.change));
  const leadShare = lead && move.change !== 0 && Math.sign(lead.change) === Math.sign(move.change) ? lead.change / sameDirection.reduce((sum, item) => sum + item.change, 0) : null;
  const market = versusMarket(move.percent, move.benchmarkPercent);

  return (
    <section className="card move-card" aria-label="Why your portfolio moved">
      <div className="move-head">
        <div>
          <div className="hero-label">Why it moved · {formatDate(move.date, { weekday: "short", day: "numeric", month: "short" })}</div>
          <div className={`move-total ${tone(move.change)}`}>
            {signedMoney(move.change, "INR")} <span>({formatPercent(move.percent)})</span>
          </div>
          <p className="small ink-2" style={{ marginTop: 4 }}>
            {move.benchmarkPercent !== null && <>Nifty 50 {formatPercent(move.benchmarkPercent)}{market && ` — ${market}`}. </>}
            {lead && leadShare !== null && move.movers.length > 1 && (
              <>{lead.shortName} drove {Math.round(Math.min(1, leadShare) * 100)}% of the {move.change < 0 ? "fall" : "rise"}.</>
            )}
          </p>
        </div>
      </div>

      <DivergingBars
        format={value => signedMoney(value, "INR")}
        rows={move.movers.map(item => ({
          id: item.id,
          label: item.shortName,
          value: item.change,
          href: `/investments/${item.id}`,
          note: formatPercent(item.percent)
        }))}
      />

      {(move.newMoney > 0 || move.pending.length > 0) && (
        <p className="small ink-3" style={{ marginTop: 12 }}>
          {move.newMoney > 0 && `${inr(move.newMoney)} of new installments that day is money you added, not a gain, so it isn't counted. `}
          {move.pending.length > 0 && `Not yet updated for this day: ${move.pending.join(", ")}.`}
        </p>
      )}
    </section>
  );
}
