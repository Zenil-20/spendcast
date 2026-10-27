import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { formatMoney, formatPercent, formatUnits, signedMoney, tone } from "../../lib/format";
import type { Holding, Portfolio } from "../../lib/types";
import { ZoneBadge } from "../../components/EntrySignal";

type Sort = "value" | "returns" | "gain" | "day" | "xirr" | "name";

const inr = (value: number) => formatMoney(value, "INR", "whole");

const SORTS: Record<Sort, { label: string; compare: (a: Holding, b: Holding) => number }> = {
  value: { label: "Current value", compare: (a, b) => b.value - a.value },
  returns: { label: "Returns (%)", compare: (a, b) => (b.absoluteReturn ?? -Infinity) - (a.absoluteReturn ?? -Infinity) },
  gain: { label: "Returns (₹)", compare: (a, b) => b.gain - a.gain },
  day: { label: "1D change", compare: (a, b) => (b.dayChangePercent ?? -Infinity) - (a.dayChangePercent ?? -Infinity) },
  xirr: { label: "XIRR", compare: (a, b) => (b.xirr ?? -Infinity) - (a.xirr ?? -Infinity) },
  name: { label: "Name (A–Z)", compare: (a, b) => a.shortName.localeCompare(b.shortName) }
};

export function HoldingsPage({ data }: { data: Portfolio }) {
  const [sort, setSort] = useState<Sort>("value");
  const holdings = useMemo(() => [...data.holdings].sort(SORTS[sort].compare), [data.holdings, sort]);

  return (
    <>
      <div className="list-toolbar">
        <span className="small ink-3">{holdings.length} {holdings.length === 1 ? "fund" : "funds"} · {inr(data.totals.value)}</span>
        <label className="row small ink-2" style={{ gap: 8 }}>
          Sort by
          <select className="select compact" value={sort} onChange={event => setSort(event.target.value as Sort)}>
            {(Object.keys(SORTS) as Sort[]).map(key => <option key={key} value={key}>{SORTS[key].label}</option>)}
          </select>
        </label>
      </div>

      <div className="holding-list">
        {holdings.map(holding => (
          <Link to={`/investments/${holding.id}`} className="holding-row" key={holding.id}>
            <div style={{ minWidth: 0 }}>
              <div className="name">{holding.shortName}</div>
              <div className="tags">
                <span className="badge">{holding.category}</span>
                {holding.plan && <span className="badge">{holding.plan}</span>}
                <HoldingKindTags holding={holding} />
                {holding.entry && <ZoneBadge zone={holding.entry.zone} />}
                {holding.awaitingNav > 0 && <span className="badge warn">Awaiting today's NAV</span>}
              </div>
            </div>
            <div className="right row" style={{ gap: 10 }}>
              <div>
                <div className="value">{inr(holding.value)}</div>
                <div className={`ret ${tone(holding.gain)}`}>{signedMoney(holding.gain, "INR")} ({formatPercent(holding.absoluteReturn)})</div>
              </div>
              <ChevronRight size={16} className="ink-3" />
            </div>
            <div className="meta-line">
              <span>Invested <b>{inr(holding.invested)}</b></span>
              <span>XIRR <b className={holding.holdingDays >= 365 ? tone(holding.xirr) : ""}>{holding.holdingDays >= 365 ? formatPercent(holding.xirr) : "—"}</b></span>
              <span>1D <b className={tone(holding.dayChangePercent)}>{formatPercent(holding.dayChangePercent)}</b></span>
              <span>Units <b>{formatUnits(holding.units)}</b></span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

// How the fund is held: an active SIP, a stopped one, and any extra purchases.
function HoldingKindTags({ holding }: { holding: Holding }) {
  const hadSip = holding.investments.some(item => item.kind === "sip");
  const purchases = holding.purchaseCount;

  return (
    <>
      {holding.activeSipCount > 0 && <span className="tag sip">SIP {inr(holding.monthlySip)}/mo</span>}
      {holding.activeSipCount === 0 && hadSip && <span className="badge">SIP stopped</span>}
      {purchases > 0 && (
        <span className="badge">
          {hadSip ? `+${purchases} extra purchase${purchases === 1 ? "" : "s"}` : purchases === 1 ? "One-time" : `${purchases} purchases`}
        </span>
      )}
    </>
  );
}
