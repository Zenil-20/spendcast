import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronRight, Info, Plus, TrendingDown, TrendingUp } from "lucide-react";
import { usePortfolio } from "../lib/queries";
import { formatDate, formatMoney, formatPercent, formatUnits, ordinal, signedMoney, tone } from "../lib/format";
import type { AllocationEntry, Holding, Insight, Portfolio } from "../lib/types";
import { rangeLabel, TIMELINE_RANGES, trimToRange, type TimelineRange } from "../lib/series";
import { TimeChart } from "../components/TimeChart";
import { AddInvestmentModal } from "../components/AddInvestmentModal";
import { ZoneBadge } from "../components/EntrySignal";
import { ChartBuilder } from "../components/ChartBuilder";
import { DivergingBars } from "../components/DivergingBars";
import { TodayMoveCard } from "../components/TodayMove";
import { HarvestCard } from "../components/HarvestCard";
import { GoalsTab } from "../components/Goals";
import { Button, DateTile, Segmented, Skeleton } from "../components/ui";

type Tab = "holdings" | "analysis" | "goals" | "compare" | "sips";
type Sort = "value" | "returns" | "gain" | "day" | "xirr" | "name";

const inr = (value: number, style: "full" | "whole" | "compact" = "whole") => formatMoney(value, "INR", style);

const SORTS: Record<Sort, { label: string; compare: (a: Holding, b: Holding) => number }> = {
  value: { label: "Current value", compare: (a, b) => b.value - a.value },
  returns: { label: "Returns (%)", compare: (a, b) => (b.absoluteReturn ?? -Infinity) - (a.absoluteReturn ?? -Infinity) },
  gain: { label: "Returns (₹)", compare: (a, b) => b.gain - a.gain },
  day: { label: "1D change", compare: (a, b) => (b.dayChangePercent ?? -Infinity) - (a.dayChangePercent ?? -Infinity) },
  xirr: { label: "XIRR", compare: (a, b) => (b.xirr ?? -Infinity) - (a.xirr ?? -Infinity) },
  name: { label: "Name (A–Z)", compare: (a, b) => a.shortName.localeCompare(b.shortName) }
};

export function Investments() {
  const portfolio = usePortfolio();
  const [adding, setAdding] = useState(false);
  const data = portfolio.data;

  return (
    <>
      <div className="row between wrap" style={{ marginBottom: 20, gap: 12 }}>
        <div className="row" style={{ gap: 12 }}>
          <h1 className="title" style={{ fontSize: 26 }}>Investments</h1>
          {data?.asOf && <MarketChip data={data} />}
        </div>
        <Button variant="secondary" icon={<Plus size={15} />} onClick={() => setAdding(true)}>Add a fund</Button>
      </div>

      {portfolio.isPending && <PortfolioSkeleton />}

      {portfolio.isError && (
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          <div>
            {portfolio.error.message} <button className="btn btn-link" onClick={() => portfolio.refetch()}>Try again</button>
          </div>
        </div>
      )}

      {data && data.holdings.length === 0 && (
        <div className="summary-card" style={{ padding: 32, maxWidth: 680 }}>
          <h2 className="display" style={{ fontSize: 30 }}>Track every SIP without typing in a single old statement.</h2>
          <p className="lede" style={{ marginTop: 12 }}>
            Choose your fund, enter the SIP amount and the date it started. Every installment is rebuilt from the published
            NAVs, including the ones that fell on a market holiday.
          </p>
          <div style={{ marginTop: 22 }}>
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => setAdding(true)}>Add your first fund</Button>
          </div>
        </div>
      )}

      {data && data.holdings.length > 0 && <PortfolioView data={data} />}

      <AddInvestmentModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

// Only states what is certain: weekends are closed; weekday holidays can't be
// known in advance from NAV data, so no "open" claim is made.
function MarketChip({ data }: { data: Portfolio }) {
  return (
    <span className="market-chip">
      <span className="dot" />
      {data.calendar?.todayIsWeekend && "Weekend · "}NAVs as of {formatDate(data.asOf!, { weekday: "short", day: "numeric", month: "short" })}
    </span>
  );
}

function PortfolioView({ data }: { data: Portfolio }) {
  const [tab, setTab] = useState<Tab>("holdings");
  const { totals } = data;

  return (
    <div style={{ display: "grid", gap: 32 }}>
      <SummaryCard data={data} />

      {data.todayMove && <TodayMoveCard move={data.todayMove} />}

      <section>
        <div className="section-tabs" role="tablist" aria-label="Portfolio sections">
          {([
            ["holdings", "Holdings", data.holdings.length],
            ["analysis", "Analysis", null],
            ["goals", "Goals", null],
            ["compare", "Compare", null],
            ["sips", "SIPs", data.sips.active.length]
          ] as [Tab, string, number | null][]).map(([key, label, count]) => (
            <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
              {label}{count !== null && <span className="count">{count}</span>}
            </button>
          ))}
        </div>

        {tab === "holdings" && <HoldingsTab data={data} />}
        {tab === "analysis" && <AnalysisTab data={data} />}
        {tab === "goals" && <GoalsTab holdings={data.holdings} />}
        {tab === "compare" && <ChartBuilder holdings={data.holdings} />}
        {tab === "sips" && <SipsTab data={data} />}
      </section>

      <p className="disclaimer" style={{ borderTop: "1px solid var(--rule)", paddingTop: 18 }}>
        NAVs refresh nightly after midnight IST. Installments due on a weekend or market holiday use the next trading day's
        NAV. Units are after 0.005% stamp duty. Tax figures are estimates under current rules and exclude gains you've
        already booked this year. For tracking only — not investment advice.
        {totals.xirr !== null && !totals.annualised && " XIRR appears once your oldest investment is a year old."}
      </p>
    </div>
  );
}

function SummaryCard({ data }: { data: Portfolio }) {
  const [range, setRange] = useState<TimelineRange>("1Y");
  const { totals } = data;

  const timeline = useMemo(() => trimToRange(data.timeline, range), [data.timeline, range]);
  const byDate = useMemo(() => new Map(data.timeline.map(point => [point.date, point])), [data.timeline]);

  return (
    <section className="summary-card" aria-label="Portfolio summary">
      <div className="summary-top">
        <div>
          <div className="hero-label">Current value</div>
          <div className="hero-value">{inr(totals.value)}</div>
          <div className={`hero-sub ${tone(totals.gain)}`}>
            {signedMoney(totals.gain, "INR")} ({formatPercent(totals.absoluteReturn)}) <span className="ink-3" style={{ fontWeight: 500 }}>overall</span>
          </div>
        </div>
      </div>

      <div className="stat-row">
        <div>
          <div className="k">Invested</div>
          <div className="v">{inr(totals.invested)}</div>
        </div>
        <div>
          <div className="k">Total returns</div>
          <div className={`v ${tone(totals.gain)}`}>{signedMoney(totals.gain, "INR")}</div>
          <div className={`s ${tone(totals.gain)}`}>{formatPercent(totals.absoluteReturn)}</div>
        </div>
        <div>
          <div className="k">1D returns</div>
          <div className={`v ${tone(totals.dayChange)}`}>{signedMoney(totals.dayChange, "INR")}</div>
          <div className={`s ${tone(totals.dayChange)}`}>{formatPercent(totals.dayChangePercent)}</div>
        </div>
        <div>
          <div className="k">XIRR</div>
          <div className={`v ${totals.annualised ? tone(totals.xirr) : ""}`}>{totals.annualised ? formatPercent(totals.xirr) : "—"}</div>
          <div className="s ink-3">{totals.annualised ? "annualised" : "after 1 year"}</div>
        </div>
      </div>

      <TimeChart
        ariaLabel="Portfolio value and money invested over time"
        animationKey={range}
        fromZero
        height={260}
        series={[
          { key: "value", label: "Current value", color: "var(--series-recurring)", shape: "step", area: true, points: timeline.map(p => ({ date: p.date, value: p.value })) },
          { key: "invested", label: "Invested", color: "var(--series-variable)", shape: "step", points: timeline.map(p => ({ date: p.date, value: p.invested })) }
        ]}
        formatAxis={value => inr(value, "compact")}
        toolbar={
          <Segmented<TimelineRange>
            label="Chart range"
            value={range}
            onChange={setRange}
            options={TIMELINE_RANGES.map(value => ({ value, label: rangeLabel(value) }))}
          />
        }
        renderReadout={({ date, values, hovering }) => {
          // Gain needs both numbers, even when one line is hidden.
          const point = byDate.get(date);
          const first = timeline[0];
          const gain = point ? point.value - point.invested : 0;
          const rangeChange = point && first ? point.value - first.value - (point.invested - first.invested) : 0;
          return (
            <>
              <span className="r-date">
                {hovering ? formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : `Latest · ${formatDate(date, { day: "numeric", month: "short", year: "numeric" })}`}
              </span>
              {values.value !== undefined && <span className="r-item"><i style={{ background: "var(--series-recurring)" }} />Value <b>{inr(values.value)}</b></span>}
              {values.invested !== undefined && <span className="r-item"><i style={{ background: "var(--series-variable)" }} />Invested <b>{inr(values.invested)}</b></span>}
              <span className="r-item">Gain <b className={tone(gain)}>{signedMoney(gain, "INR")}</b></span>
              {!hovering && first && (
                <span className="r-item">Market gain over {range === "ALL" ? "all time" : range} <b className={tone(rangeChange)}>{signedMoney(rangeChange, "INR")}</b></span>
              )}
            </>
          );
        }}
      />
    </section>
  );
}

function HoldingsTab({ data }: { data: Portfolio }) {
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

function InsightCard({ insight }: { insight: Insight }) {
  const Icon = insight.tone === "positive" ? TrendingUp : insight.tone === "attention" ? (insight.id === "market" ? TrendingDown : AlertTriangle) : Info;
  return (
    <div className={`insight ${insight.tone}`}>
      <span className="ic"><Icon size={15} /></span>
      <div>
        <div className="t">{insight.title}</div>
        <div className="d">{insight.detail}</div>
      </div>
    </div>
  );
}

function AnalysisTab({ data }: { data: Portfolio }) {
  const [allocationBy, setAllocationBy] = useState<"byCategory" | "byAssetClass" | "byFundHouse">("byCategory");
  const { market, tax, totals } = data;

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {data.insights.length > 0 && (
        <div className="insights">
          {data.insights.map(insight => <InsightCard key={insight.id} insight={insight} />)}
        </div>
      )}

      <div className="cards-2">
        {market && (
          <div className="card">
            <h3>Against the market</h3>
            <div className="sub">Your payments, on the same dates, in {market.benchmarkName ?? "a Nifty 50 index fund"}.</div>
            <div className="compare-bars">
              {[
                { label: "Your funds", value: totals.value, xirr: totals.xirr, color: "var(--series-recurring)" },
                { label: "Nifty 50", value: market.value, xirr: market.xirr, color: "var(--ink-3)" }
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

        <div className="card">
          <h3>Where your returns come from</h3>
          <div className="sub">Each fund's gain or loss in rupees.</div>
          <Contribution data={data} />
        </div>

        <div className="card">
          <div className="row between" style={{ alignItems: "start", marginBottom: 14 }}>
            <div>
              <h3>Allocation</h3>
              <div className="sub" style={{ marginBottom: 0 }}>Share of current value.</div>
            </div>
            <Segmented
              label="Group by"
              value={allocationBy}
              onChange={setAllocationBy}
              options={[{ value: "byCategory", label: "Category" }, { value: "byAssetClass", label: "Asset" }, { value: "byFundHouse", label: "AMC" }]}
            />
          </div>
          <Allocation entries={data.allocation[allocationBy]} />
        </div>
      </div>

      <HarvestCard initial={data.harvest} />
    </div>
  );
}

function Contribution({ data }: { data: Portfolio }) {
  return (
    <DivergingBars
      format={value => signedMoney(value, "INR")}
      rows={data.contribution.map(item => ({ id: item.id, label: item.shortName, value: item.gain, href: `/investments/${item.id}` }))}
    />
  );
}

function Allocation({ entries }: { entries: AllocationEntry[] }) {
  if (!entries.length) return null;
  const largest = entries[0].value || 1;

  return (
    <div className="breakdown">
      {entries.map(entry => (
        <div className="breakdown-row" key={entry.name}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
          <span className="amount small">{formatPercent(entry.share, { sign: false, digits: 1 })} · {inr(entry.value, "compact")}</span>
          <div className="bar"><span style={{ width: `${(entry.value / largest) * 100}%`, transition: "width 400ms ease" }} /></div>
        </div>
      ))}
    </div>
  );
}

function SipsTab({ data }: { data: Portfolio }) {
  const { sips } = data;

  return (
    <div style={{ display: "grid", gap: 24 }}>
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
          <Link to={`/investments/${sip.id}`} key={sip.id} className="sip-row" style={{ textDecoration: "none", color: "inherit" }}>
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
            <Link to={`/investments/${sip.id}`} key={sip.id} className="sip-row" style={{ textDecoration: "none", color: "inherit", opacity: 0.75 }}>
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

function PortfolioSkeleton() {
  return (
    <div className="summary-card" aria-busy="true">
      <Skeleton height={12} width={100} />
      <Skeleton height={42} width={260} style={{ marginTop: 10 }} />
      <Skeleton height={14} width={180} style={{ marginTop: 12 }} />
      <Skeleton height={260} style={{ marginTop: 28 }} />
    </div>
  );
}
