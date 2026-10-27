import { formatMoney, formatPercent, signedMoney, tone } from "../../lib/format";
import type { Portfolio } from "../../lib/types";
import { DivergingBars } from "../../components/DivergingBars";
import { ChartBuilder } from "../../components/ChartBuilder";
import { PageParts } from "./PageParts";

const inr = (value: number) => formatMoney(value, "INR", "whole");

// "How have my funds done?": against the market, then against each other.
export function PerformancePage({ data }: { data: Portfolio }) {
  return (
    <PageParts
      parts={[
        { id: "market", title: "Against the market", description: "Your returns next to the Nifty 50, and which funds they came from.", content: <MarketCards data={data} /> },
        { id: "compare", title: "Compare your funds", description: "Chart any of your funds against each other, and save the views you use.", content: <ChartBuilder holdings={data.holdings} /> }
      ]}
    />
  );
}

function MarketCards({ data }: { data: Portfolio }) {
  const { market, totals } = data;

  return (
    <div className="cards-2">
      {market && (
        <div className="card">
          <h3>Your funds vs the Nifty 50</h3>
          <div className="sub">Your payments, on the same dates, in {market.benchmarkName ?? "a Nifty 50 index fund"}.</div>
          <div className="compare-bars">
            {[
              { label: "Your funds", value: totals.value, color: "var(--series-recurring)" },
              { label: "Nifty 50", value: market.value, color: "var(--ink-3)" }
            ].map(row => (
              <div className="cb" key={row.label}>
                <span>{row.label}</span>
                <span className="track"><span style={{ width: `${(row.value / Math.max(totals.value, market.value)) * 100}%`, background: row.color }} /></span>
                <span className="amount">{inr(row.value)}</span>
              </div>
            ))}
          </div>
          <dl className="kv-list" style={{ marginTop: 16 }}>
            <dt>Difference</dt>
            <dd className={tone(market.difference)}>{signedMoney(market.difference, "INR")}</dd>
            {totals.annualised && (
              <>
                <dt>XIRR — yours vs Nifty 50</dt>
                <dd>{formatPercent(totals.xirr)} vs {formatPercent(market.xirr)}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      <div className="card">
        <h3>Where your returns come from</h3>
        <div className="sub">Each fund's gain or loss in rupees.</div>
        <DivergingBars
          format={value => signedMoney(value, "INR")}
          rows={data.contribution.map(item => ({ id: item.id, label: item.shortName, value: item.gain, href: `/investments/${item.id}` }))}
        />
      </div>
    </div>
  );
}
