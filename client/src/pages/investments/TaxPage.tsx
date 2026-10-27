import { formatDate, formatMoney, signedMoney, tone } from "../../lib/format";
import type { Portfolio } from "../../lib/types";
import { HarvestCard } from "../../components/HarvestCard";

const inr = (value: number) => formatMoney(value, "INR", "whole");

export function TaxPage({ data }: { data: Portfolio }) {
  const { tax } = data;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="card">
        <h3>Tax if you sold everything today</h3>
        <div className="sub">Estimate for equity funds: short-term {tax.rates.shortTerm * 100}%, long-term {tax.rates.longTerm * 100}% above {inr(tax.exemption)} a year, plus {tax.rates.cess * 100}% cess.</div>
        <dl className="kv-list">
          <dt>Long-term gains <span className="ink-3">(held over a year)</span></dt>
          <dd className={tone(tax.longTermGain)}>{signedMoney(tax.longTermGain, "INR")}</dd>
          <dt>Short-term gains</dt>
          <dd className={tone(tax.shortTermGain)}>{signedMoney(tax.shortTermGain, "INR")}</dd>
          {tax.slabGain !== 0 && (
            <>
              <dt>Other funds <span className="ink-3">(taxed at your slab)</span></dt>
              <dd className={tone(tax.slabGain)}>{signedMoney(tax.slabGain, "INR")}</dd>
            </>
          )}
          <dt className="total">Estimated tax</dt>
          <dd className="total">{inr(tax.estimate.total)}</dd>
        </dl>
        <div style={{ marginTop: 14 }}>
          <div className="row between small ink-2" style={{ marginBottom: 6 }}>
            <span>Tax-free long-term allowance used</span>
            <span className="amount">{inr(tax.estimate.exemptionUsed)} of {inr(tax.exemption)}</span>
          </div>
          <div className="progress ok"><span style={{ width: `${Math.min(100, (tax.estimate.exemptionUsed / tax.exemption) * 100)}%` }} /></div>
        </div>
        {tax.turningLongTerm.length > 0 && (
          <p className="small ink-2" style={{ marginTop: 12 }}>
            Turning long-term soon: {tax.turningLongTerm.map(item => `${item.shortName} from ${formatDate(item.firstDate, { day: "numeric", month: "short" })}`).join(", ")}.
          </p>
        )}
      </div>

      <HarvestCard initial={data.harvest} />

      <p className="disclaimer">Tax figures are estimates under current rules and exclude gains you've already booked this year.</p>
    </div>
  );
}
