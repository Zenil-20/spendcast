import { Link } from "react-router-dom";
import { formatDate, formatMoney, formatUnits, ordinal } from "../../lib/format";
import type { Portfolio } from "../../lib/types";
import { DateTile } from "../../components/ui";

const inr = (value: number) => formatMoney(value, "INR", "whole");

export function SipsPage({ data }: { data: Portfolio }) {
  const { sips } = data;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="stat-row" style={{ margin: 0 }}>
        <div>
          <div className="k">Monthly SIP total</div>
          <div className="v">{inr(sips.monthlyTotal)}</div>
        </div>
        <div>
          <div className="k">Still to debit this month</div>
          <div className="v">{inr(sips.remainingThisMonth)}</div>
        </div>
        <div>
          <div className="k">Next 7 days</div>
          <div className="v">{inr(sips.nextWeekTotal)}</div>
        </div>
        <div>
          <div className="k">Active SIPs</div>
          <div className="v">{sips.active.length}</div>
        </div>
      </div>

      <div>
        {sips.active.length === 0 && <p className="ink-3 small">No active SIPs.</p>}
        {sips.active.map(sip => (
          <Link to={`/investments/${sip.id}`} key={sip.investmentId} className="sip-row" style={{ textDecoration: "none", color: "inherit" }}>
            {sip.next ? <DateTile date={sip.next.dueDate} /> : <span />}
            <div style={{ minWidth: 0 }}>
              <div className="t">{sip.shortName}</div>
              <div className="s">
                {inr(sip.amount)} on the {ordinal(sip.sipDay ?? 1)} of every month
                {sip.stepUpPercent > 0 && ` · +${sip.stepUpPercent}% a year`}
                {" · "}{sip.installmentsAllotted} installments, {inr(sip.invested)} so far
              </div>
              {sip.next?.onWeekend && <div className="s">Next date is a weekend — the next trading day's NAV will apply.</div>}
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="amount">{inr(sip.amount)}</div>
              {sip.next?.estimatedUnits !== undefined && <div className="small ink-3">≈ {formatUnits(sip.next.estimatedUnits)} units</div>}
            </div>
          </Link>
        ))}
      </div>

      {sips.stopped.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Stopped</div>
          {sips.stopped.map(sip => (
            <Link to={`/investments/${sip.id}`} key={sip.investmentId} className="sip-row" style={{ textDecoration: "none", color: "inherit", opacity: 0.75 }}>
              <span />
              <div>
                <div className="t">{sip.shortName}</div>
                <div className="s">
                  {inr(sip.amount)} on the {ordinal(sip.sipDay ?? 1)} · {formatDate(sip.startDate, { month: "short", year: "numeric" })} – {sip.endDate ? formatDate(sip.endDate, { month: "short", year: "numeric" }) : ""}
                </div>
              </div>
              <div className="amount small">{inr(sip.invested)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
