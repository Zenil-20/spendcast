import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { useDeleteHolding, useDeleteInvestment, useHolding, useUpdateInvestment } from "../lib/queries";
import { formatDate, formatMoney, formatNav, formatPercent, formatRatio, formatUnits, ordinal, signedMoney, tone } from "../lib/format";
import { validateAmount } from "../lib/validation";
import { useToast } from "../lib/toast";
import type { ChartRange, HoldingDetail as Detail, Installment, InvestmentKind, InvestmentSummary, SchemeSearchResult } from "../lib/types";
import { TimeChart, type Marker } from "../components/TimeChart";
import { AddInvestmentModal } from "../components/AddInvestmentModal";
import { EntrySignalCard } from "../components/EntrySignal";
import { SipDateCard } from "../components/SipDateCard";
import { Button, Dialog, Field, MoneyInput, Segmented, Skeleton } from "../components/ui";

const inr = (value: number, style: "full" | "whole" | "compact" = "whole") => formatMoney(value, "INR", style);
const RANGES: ChartRange[] = ["1M", "3M", "6M", "1Y", "3Y", "5Y", "ALL"];
type Tab = "performance" | "transactions" | "tax";

export function HoldingDetail() {
  const { id = "" } = useParams();
  const [range, setRange] = useState<ChartRange>("1Y");
  const query = useHolding(id, range);

  return (
    <>
      <Link to="/investments/holdings" className="row small ink-2" style={{ gap: 6, textDecoration: "none", marginBottom: 18, display: "inline-flex" }}>
        <ArrowLeft size={14} /> Holdings
      </Link>

      {query.isPending && (
        <div style={{ display: "grid", gap: 20 }} aria-busy="true">
          <Skeleton height={30} width="45%" />
          <div className="fund-layout"><Skeleton height={380} /><Skeleton height={380} /></div>
        </div>
      )}

      {query.isError && <div className="notice error" role="alert"><AlertTriangle size={16} /><div>{query.error.message}</div></div>}

      {query.data && <HoldingView data={query.data} range={range} onRangeChange={setRange} refreshing={query.isFetching} />}
    </>
  );
}

type Confirm =
  | { type: "stop"; investment: InvestmentSummary }
  | { type: "delete-purchase"; investment: InvestmentSummary }
  | { type: "delete-fund" };

// Actions on the fund's SIPs and purchases, shared by the position card and
// the transactions list.
interface Actions {
  add: (kind: InvestmentKind) => void;
  edit: (investment: InvestmentSummary) => void;
  confirm: (confirm: Confirm) => void;
}

function HoldingView({ data, range, onRangeChange, refreshing }: {
  data: Detail;
  range: ChartRange;
  onRangeChange: (range: ChartRange) => void;
  refreshing: boolean;
}) {
  const { holding } = data;
  const [tab, setTab] = useState<Tab>("performance");
  const [adding, setAdding] = useState<InvestmentKind | null>(null);
  const [editing, setEditing] = useState<InvestmentSummary | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const latest = holding.latestNav;
  const actions: Actions = { add: setAdding, edit: setEditing, confirm: setConfirm };

  // Stable, so the add dialog doesn't reset while open.
  const fund = useMemo<SchemeSearchResult>(() => ({
    schemeCode: holding.schemeCode,
    schemeName: holding.schemeName,
    isinGrowth: data.meta.isinGrowth,
    isinDivReinvestment: data.meta.isinDivReinvestment
  }), [holding.schemeCode, holding.schemeName, data.meta.isinGrowth, data.meta.isinDivReinvestment]);

  const chartStart = data.chart[0]?.date ?? "";
  const markers: Marker[] = holding.installments
    .filter(item => item.status === "allotted" && item.navDate! >= chartStart)
    .map(item => ({
      date: item.navDate!,
      value: item.nav!,
      label: `${formatUnits(item.units)} units for ${inr(item.amount)}${item.source === "lumpsum" ? " (extra)" : ""}`
    }));

  const first = data.chart[0];
  const last = data.chart[data.chart.length - 1];
  const rangeReturn = first && last ? last.nav / first.nav - 1 : null;

  // Nifty 50 rebased to start at the fund's first NAV in the range, so both
  // lines can be read on one scale.
  const benchmarkLine = useMemo(() => {
    const points = data.benchmarkChart.filter(point => point.date >= chartStart);
    if (!first || !points.length) return [];
    const scale = first.nav / points[0].nav;
    return points.map(point => ({ date: point.date, value: point.nav * scale }));
  }, [data.benchmarkChart, chartStart, first]);

  return (
    <div style={{ display: "grid", gap: 28 }}>
      <header className="row between wrap" style={{ alignItems: "flex-end", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="title" style={{ fontSize: 28 }}>{holding.shortName}</h1>
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            <span className="badge">{holding.category}</span>
            {holding.plan && <span className="badge">{holding.plan}</span>}
            {holding.option && <span className="badge">{holding.option}</span>}
            {holding.fundHouse && <span className="badge">{holding.fundHouse.replace(/ Mutual Fund$/i, "")}</span>}
            <span className="small ink-3 mono" style={{ marginLeft: 4 }}>{holding.schemeCode}</span>
          </div>
        </div>
        {latest && (
          <div style={{ textAlign: "right" }}>
            <div className="hero-label">NAV · {formatDate(latest.date, { day: "numeric", month: "short" })}</div>
            <div className="amount" style={{ fontSize: 24, marginTop: 2 }}>{formatNav(latest.nav)}</div>
            <div className={`small amount ${tone(holding.dayChangePercent)}`}>{formatPercent(holding.dayChangePercent)} 1D</div>
          </div>
        )}
      </header>

      <div className="fund-layout">
        <section className="summary-card" style={{ paddingBottom: 14 }} aria-label="NAV history">
          <TimeChart
            ariaLabel={`NAV of ${holding.schemeName}`}
            animationKey={range}
            height={290}
            series={[
              { key: "nav", label: "NAV", color: "var(--series-recurring)", shape: "smooth", area: true, points: data.chart.map(p => ({ date: p.date, value: p.nav })) },
              ...(benchmarkLine.length ? [{ key: "nifty", label: "Nifty 50 (same start)", color: "var(--chart-3)", shape: "smooth" as const, points: benchmarkLine }] : [])
            ]}
            initiallyHidden={["nifty"]}
            markers={markers}
            formatAxis={value => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: value < 100 ? 1 : 0 })}`}
            toolbar={
              <div className="row" style={{ gap: 10 }}>
                {refreshing && <span className="spinner ink-3" aria-label="Updating" />}
                <Segmented<ChartRange> label="Chart range" value={range} onChange={onRangeChange} options={RANGES.map(value => ({ value, label: value === "ALL" ? "All" : value }))} />
              </div>
            }
            renderReadout={({ date, values, markers: bought, hovering }) => {
              const gap = values.nav !== undefined && values.nifty !== undefined ? values.nav / values.nifty - 1 : null;
              return (
                <>
                  <span className="r-date">{hovering ? formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : `Latest · ${formatDate(date, { day: "numeric", month: "short", year: "numeric" })}`}</span>
                  {values.nav !== undefined && <span className="r-item"><i style={{ background: "var(--series-recurring)" }} />NAV <b>{formatNav(values.nav)}</b></span>}
                  {!hovering && rangeReturn !== null && (
                    <span className="r-item">{range === "ALL" ? "Since launch" : range} <b className={tone(rangeReturn)}>{formatPercent(rangeReturn)}</b></span>
                  )}
                  {gap !== null && (
                    <span className="r-item"><i style={{ background: "var(--chart-3)" }} />vs Nifty 50 since {formatDate(chartStart, { day: "numeric", month: "short", year: "2-digit" })} <b className={tone(gap)}>{formatPercent(gap)}</b></span>
                  )}
                  {bought.map(marker => (
                    <span className="r-item" key={marker.date + marker.label}><i style={{ background: "var(--series-variable)", borderRadius: "50%" }} />You bought <b>{marker.label}</b></span>
                  ))}
                </>
              );
            }}
          />
        </section>

        <PositionCard data={data} actions={actions} />
      </div>

      {data.metrics.entry && latest && <EntrySignalCard signal={data.metrics.entry} nav={latest.nav} />}
      {!data.metrics.entry && latest && (
        <p className="small ink-3" style={{ marginTop: -12 }}>
          Today's price check appears once this fund has about two years of NAV history — it compares today's price with the fund's
          own usual level and with how buying at similar levels worked out a year later.
        </p>
      )}

      <section>
        <div className="section-tabs" role="tablist" aria-label="Fund sections">
          {([["performance", "Performance"], ["transactions", "Transactions"], ["tax", "Tax"]] as [Tab, string][]).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
              {label}
              {key === "transactions" && <span className="count">{holding.installments.length}</span>}
            </button>
          ))}
        </div>
        {tab === "performance" && <Performance data={data} />}
        {tab === "transactions" && <Transactions data={data} actions={actions} />}
        {tab === "tax" && <TaxTab data={data} />}
      </section>

      <p className="disclaimer" style={{ borderTop: "1px solid var(--rule)", paddingTop: 18 }}>
        Past returns don't predict future returns. Risk figures use the last year of daily NAVs and a 6.5% risk-free rate;
        the benchmark is {data.benchmarkName ?? "a Nifty 50 index fund"}. For tracking only — not investment advice.
      </p>

      <AddInvestmentModal open={adding !== null} onClose={() => setAdding(null)} initialFund={fund} lockedKind={adding} />
      <EditDialog investment={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} data={data} />
    </div>
  );
}

function PositionCard({ data, actions }: { data: Detail; actions: Actions }) {
  const { holding, market } = data;
  const sips = holding.investments.filter(item => item.kind === "sip");
  const activeSips = sips.filter(item => !item.stopped);
  const lastStopped = sips.filter(item => item.stopped).sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""))[0];
  const purchases = holding.investments.filter(item => item.kind === "lumpsum");
  const purchasesInvested = purchases.reduce((sum, item) => sum + item.invested, 0);

  return (
    <aside className="summary-card position-card" style={{ padding: 22 }}>
      <div className="hero-label">Your investment</div>
      <div className="big" style={{ marginTop: 4 }}>{inr(holding.value)}</div>
      <div className={`small amount ${tone(holding.gain)}`} style={{ marginTop: 4, fontWeight: 600 }}>
        {signedMoney(holding.gain, "INR")} ({formatPercent(holding.absoluteReturn)})
      </div>

      <dl className="kv-list" style={{ marginTop: 18 }}>
        <dt>Invested</dt><dd>{inr(holding.invested)}</dd>
        <dt>XIRR</dt><dd className={holding.holdingDays >= 365 ? tone(holding.xirr) : ""}>{holding.holdingDays >= 365 ? formatPercent(holding.xirr) : "after 1 year"}</dd>
        <dt>Units</dt><dd>{formatUnits(holding.units)}</dd>
        <dt>Average NAV</dt><dd>{formatNav(holding.averageCost)}</dd>
        <dt>1D change</dt><dd className={tone(holding.dayChange)}>{signedMoney(holding.dayChange, "INR")}</dd>
      </dl>

      {market && (
        <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 8, background: "var(--paper)", fontSize: 12.5 }}>
          <span className="ink-2">Same payments in the Nifty 50: </span>
          <span className="amount">{inr(market.value)}</span>
          <div className={tone(market.difference)} style={{ fontWeight: 600, marginTop: 2 }}>
            {market.difference >= 0 ? "You're ahead by " : "You're behind by "}{inr(Math.abs(market.difference))}
          </div>
        </div>
      )}

      {activeSips.map(sip => (
        <div key={sip.id} style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
          <div className="row between">
            <span style={{ fontWeight: 600 }}>SIP · {inr(sip.next?.amount ?? sip.amount)}</span>
            <span className="small ink-3">{ordinal(sip.sipDay ?? 1)} of every month</span>
          </div>
          {sip.next && (
            <div className="small ink-2" style={{ marginTop: 6 }}>
              Next debit {formatDate(sip.next.dueDate, { weekday: "short", day: "numeric", month: "short" })}
              {sip.next.estimatedUnits !== undefined && <> · ≈ {formatUnits(sip.next.estimatedUnits)} units at today's NAV</>}
              {sip.next.onWeekend && <div className="ink-3">Falls on a weekend — the next trading day's NAV will apply.</div>}
            </div>
          )}
          <div className="small ink-3" style={{ marginTop: 4 }}>
            Since {formatDate(sip.startDate, { month: "short", year: "numeric" })} · {sip.installmentsAllotted} installments
            {sip.stepUpPercent > 0 && ` · steps up ${sip.stepUpPercent}% a year`}
          </div>
          <div className="row" style={{ gap: 4, marginTop: 8 }}>
            <Button size="sm" variant="ghost" onClick={() => actions.edit(sip)}>Edit SIP</Button>
            <Button size="sm" variant="ghost" onClick={() => actions.confirm({ type: "stop", investment: sip })}>Stop SIP</Button>
          </div>
        </div>
      ))}

      {activeSips.length === 0 && lastStopped && (
        <div className="small ink-2" style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
          SIP stopped{lastStopped.endDate && ` on ${formatDate(lastStopped.endDate)}`} after {lastStopped.installmentsAllotted} installments.
        </div>
      )}

      {purchases.length > 0 && (
        <div className="row between small" style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
          <span className="ink-2">{sips.length ? "Extra purchases" : "One-time purchases"} · {purchases.length}</span>
          <span className="amount">{inr(purchasesInvested)}</span>
        </div>
      )}

      <div className="row wrap" style={{ gap: 8, marginTop: 16 }}>
        <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => actions.add("lumpsum")}>
          {sips.length || purchases.length ? "Add extra purchase" : "Add purchase"}
        </Button>
        {activeSips.length === 0 && <Button size="sm" onClick={() => actions.add("sip")}>Start a SIP</Button>}
        <Button size="sm" variant="ghost" onClick={() => actions.confirm({ type: "delete-fund" })}>Remove fund</Button>
      </div>
    </aside>
  );
}

function volatilityLevel(volatility: number | null): { label: string; level: number } {
  if (volatility === null) return { label: "—", level: 0 };
  if (volatility < 0.1) return { label: "Low", level: 1 };
  if (volatility < 0.18) return { label: "Moderate", level: 2 };
  return { label: "High", level: 3 };
}

function Performance({ data }: { data: Detail }) {
  const { returns, benchmarkReturns, risk, price, sipDates } = data.metrics;
  const sipDays = data.holding.investments.filter(item => item.kind === "sip" && !item.stopped && item.sipDay).map(item => item.sipDay!);
  const periods = (["1M", "3M", "6M", "1Y", "3Y", "5Y"] as const).filter(period => returns[period] !== null);
  const vol = volatilityLevel(risk?.volatility ?? null);

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div className="card">
        <h3>Returns compared with the Nifty 50</h3>
        <div className="sub">Point-to-point NAV returns; 3Y and 5Y are per year.</div>
        <div className="table-scroll">
          <table className="compare-table">
            <thead>
              <tr><th>Period</th>{periods.map(period => <th key={period}>{period}</th>)}</tr>
            </thead>
            <tbody>
              <tr>
                <td>This fund</td>
                {periods.map(period => <td key={period} className={tone(returns[period])}>{formatPercent(returns[period], { digits: 1 })}</td>)}
              </tr>
              <tr>
                <td className="ink-2">Nifty 50</td>
                {periods.map(period => <td key={period} className="ink-2">{formatPercent(benchmarkReturns[period], { digits: 1 })}</td>)}
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Difference</td>
                {periods.map(period => {
                  const fund = returns[period];
                  const index = benchmarkReturns[period];
                  const difference = fund !== null && index !== null ? fund - index : null;
                  return <td key={period} className={tone(difference)} style={{ fontWeight: 600 }}>{formatPercent(difference, { digits: 1 })}</td>;
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {sipDates && <SipDateCard study={sipDates} sipDays={sipDays} />}

      {risk && (
        <div className="cards-2">
          <div className="card">
            <h3>Risk</h3>
            <div className="sub">Last 12 months of daily NAVs.</div>
            <dl className="kv-list">
              <dt>Volatility</dt>
              <dd>
                {formatPercent(risk.volatility, { sign: false, digits: 1 })} · {vol.label}
                <span className="level" aria-hidden="true">{[1, 2, 3].map(step => <i key={step} className={step <= vol.level ? "on" : ""} />)}</span>
              </dd>
              <dt>Worst fall</dt>
              <dd className="down">{formatPercent(risk.maxDrawdown.drawdown, { digits: 1 })}</dd>
              <dt className="ink-3" style={{ gridColumn: "1 / -1", fontSize: 12, marginTop: -4 }}>
                {risk.maxDrawdown.drawdown < 0 && `From ${formatDate(risk.maxDrawdown.peakDate)} to ${formatDate(risk.maxDrawdown.troughDate)}`}
              </dt>
              <dt>Beta <span className="ink-3">(vs Nifty 50)</span></dt>
              <dd>{formatRatio(risk.beta)}</dd>
            </dl>
            <p className="small ink-3" style={{ marginTop: 12 }}>
              {risk.beta !== null && (risk.beta < 1 ? `Tends to move ${Math.round((1 - risk.beta) * 100)}% less than the market.` : `Tends to move ${Math.round((risk.beta - 1) * 100)}% more than the market.`)}
            </p>
          </div>

          <div className="card">
            <h3>Risk-adjusted return</h3>
            <div className="sub">How much return the fund earned for the risk it took.</div>
            <dl className="kv-list">
              <dt>Sharpe ratio</dt><dd>{formatRatio(risk.sharpe)}</dd>
              <dt>Sortino ratio</dt><dd>{formatRatio(risk.sortino)}</dd>
              <dt>Alpha <span className="ink-3">(vs Nifty 50)</span></dt><dd className={tone(risk.alpha)}>{formatPercent(risk.alpha, { digits: 1 })}</dd>
            </dl>
            {price && (
              <div style={{ marginTop: 16 }}>
                <div className="row between small ink-2"><span>52-week range</span><span>{formatPercent(price.fromHigh, { digits: 1 })} from high</span></div>
                <div className="range-track" aria-hidden="true"><span className="pin" style={{ left: `${price.rangePosition * 100}%` }} /></div>
                <div className="row between small ink-3 amount"><span>{formatNav(price.low52w)}</span><span>{formatNav(price.high52w)}</span></div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Transactions({ data, actions }: { data: Detail; actions: Actions }) {
  const { holding } = data;
  const hasSip = holding.investments.some(item => item.kind === "sip");
  const byYear = useMemo(() => {
    const groups = new Map<string, Installment[]>();
    holding.installments.forEach(item => {
      const year = (item.navDate ?? item.dueDate).slice(0, 4);
      groups.set(year, [...(groups.get(year) ?? []), item]);
    });
    return [...groups.entries()];
  }, [holding.installments]);

  return (
    <div>
      {byYear.map(([year, items], index) => {
        const allotted = items.filter(item => item.status === "allotted");
        return (
          <details className="year-group" key={year} open={index === 0}>
            <summary>
              <span>{year}</span>
              <span className="row small ink-2" style={{ gap: 14, fontWeight: 500 }}>
                <span>{allotted.length} purchase{allotted.length === 1 ? "" : "s"}</span>
                <span className="amount">{inr(allotted.reduce((sum, item) => sum + item.amount, 0))}</span>
                <span className="amount">{formatUnits(allotted.reduce((sum, item) => sum + (item.units ?? 0), 0))} units</span>
                <ChevronRight size={15} className="chev" />
              </span>
            </summary>
            <div className="table-scroll">
              <table className="ledger" style={{ marginBottom: 8 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Units allotted at</th>
                    <th className="num">NAV</th>
                    <th className="num hide-sm">Amount</th>
                    <th className="num">Units</th>
                    <th style={{ width: 40 }}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <TransactionRow key={`${item.investmentId}-${item.dueDate}`} item={item} data={data} hasSip={hasSip} actions={actions} />
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </div>
  );
}

function TransactionRow({ item, data, hasSip, actions }: { item: Installment; data: Detail; hasSip: boolean; actions: Actions }) {
  const isSip = item.source === "sip";

  return (
    <tr className={item.status === "allotted" ? undefined : "muted-row"}>
      <td className="mono small" style={{ whiteSpace: "nowrap" }}>{formatDate(item.dueDate, { day: "2-digit", month: "short", year: "numeric" })}</td>
      <td>{isSip ? <span className="tag sip">SIP</span> : <span className="badge">{hasSip ? "Extra purchase" : "One-time"}</span>}</td>
      <td className="small">
        {item.status === "allotted" && !item.shifted && <span className="ink-2">Same day</span>}
        {item.status === "allotted" && item.shifted && (
          <span className="row" style={{ gap: 8 }}>
            <span className="mono">{formatDate(item.navDate!, { weekday: "short", day: "2-digit", month: "short" })}</span>
            <span className="badge" title="The date was a weekend or market holiday, so units were allotted at the next trading day's NAV.">Market closed that day</span>
          </span>
        )}
        {item.status === "awaiting_nav" && <span className="badge warn">Awaiting today's NAV</span>}
        {item.status === "skipped" && <span className="badge">Not debited</span>}
      </td>
      <td className="num small">{item.nav ? formatNav(item.nav) : "—"}</td>
      <td className="num hide-sm small">{inr(item.amount, "full")}</td>
      <td className="num">{item.units !== undefined ? formatUnits(item.units) : "—"}</td>
      <td style={{ textAlign: "right" }}>
        {item.status !== "awaiting_nav" && <RowMenu item={item} data={data} actions={actions} />}
      </td>
    </tr>
  );
}

// SIP installment: mark as not debited (bounced or cancelled mandate).
// Extra purchase: edit or delete it.
function RowMenu({ item, data, actions }: { item: Installment; data: Detail; actions: Actions }) {
  const update = useUpdateInvestment();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const investment = data.holding.investments.find(entry => entry.id === item.investmentId);
  const notDebited = item.status === "skipped";

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!investment) return null;

  async function toggleDebit() {
    setOpen(false);
    const skipped = new Set(
      data.holding.installments
        .filter(entry => entry.investmentId === item.investmentId && entry.status === "skipped")
        .map(entry => entry.dueDate)
    );
    if (notDebited) skipped.delete(item.dueDate);
    else skipped.add(item.dueDate);

    try {
      await update.mutateAsync({ id: investment!.id, changes: { skippedDates: [...skipped] } });
      toast(notDebited ? "Installment restored" : `${formatDate(item.dueDate)} marked as not debited — its units were removed`);
    } catch (error) {
      toast((error as Error).message, "error");
    }
  }

  const option = (label: string, hint: string, onClick: () => void) => (
    <button className="menu-item" role="menuitem" onClick={onClick} disabled={update.isPending} style={{ height: "auto", padding: "8px 10px", alignItems: "flex-start", flexDirection: "column", gap: 2 }}>
      <span>{label}</span>
      <span className="small ink-3" style={{ whiteSpace: "normal" }}>{hint}</span>
    </button>
  );

  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn btn-ghost btn-sm btn-icon" aria-haspopup="menu" aria-expanded={open} aria-label={`Options for ${formatDate(item.dueDate)}`} onClick={() => setOpen(value => !value)}>
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="popover" role="menu">
          {item.source === "sip"
            ? option(
              notDebited ? "Mark as debited" : "Mark as not debited",
              notDebited ? "Count this installment's units again." : "Use if the bank debit bounced or was cancelled. No units will be counted.",
              toggleDebit
            )
            : (
              <>
                {option("Edit purchase", "Change the amount or date. Units are recalculated.", () => { setOpen(false); actions.edit(investment); })}
                {option("Delete purchase", "Remove this purchase and its units.", () => { setOpen(false); actions.confirm({ type: "delete-purchase", investment }); })}
              </>
            )}
        </div>
      )}
    </div>
  );
}

function TaxTab({ data }: { data: Detail }) {
  const { holding, taxEstimate } = data;
  const { tax } = holding;

  if (!holding.equityTaxed) {
    return (
      <div className="card" style={{ maxWidth: 620 }}>
        <h3>Taxed at your income slab</h3>
        <div className="sub">This isn't an equity-oriented fund, so gains are added to your income and taxed at your slab rate.</div>
        <dl className="kv-list"><dt>Unrealised gain</dt><dd className={tone(tax.slabGain)}>{signedMoney(tax.slabGain, "INR")}</dd></dl>
      </div>
    );
  }

  return (
    <div className="cards-2">
      <div className="card">
        <h3>If you sold this fund today</h3>
        <div className="sub">Equity rules: held over 12 months is long-term (12.5% above ₹1.25 lakh a year), otherwise short-term (20%), plus 4% cess.</div>
        <dl className="kv-list">
          <dt>Long-term gain</dt><dd className={tone(tax.longTermGain)}>{signedMoney(tax.longTermGain, "INR")}</dd>
          <dt>Short-term gain</dt><dd className={tone(tax.shortTermGain)}>{signedMoney(tax.shortTermGain, "INR")}</dd>
          {taxEstimate && (
            <>
              <dt className="total">Estimated tax</dt>
              <dd className="total">{inr(taxEstimate.total)}</dd>
            </>
          )}
        </dl>
        <p className="small ink-3" style={{ marginTop: 10 }}>Assumes no other gains this financial year. The ₹1.25 lakh allowance is shared across all your funds.</p>
      </div>
      <div className="card">
        <h3>Becoming long-term</h3>
        <div className="sub">Units cross 12 months on a rolling basis — each SIP installment separately.</div>
        {tax.turningLongTerm.units > 0 && tax.turningLongTerm.firstDate ? (
          <p style={{ fontSize: 14 }}>
            <span className="amount">{formatUnits(tax.turningLongTerm.units)}</span> units with a gain of{" "}
            <span className={`amount ${tone(tax.turningLongTerm.gain)}`}>{signedMoney(tax.turningLongTerm.gain, "INR")}</span> become long-term from{" "}
            <strong>{formatDate(tax.turningLongTerm.firstDate, { day: "numeric", month: "long" })}</strong>, within the next 30 days.
          </p>
        ) : (
          <p className="small ink-2">No units cross the 12-month mark in the next 30 days.</p>
        )}
      </div>
    </div>
  );
}

function EditDialog({ investment, onClose }: { investment: InvestmentSummary | null; onClose: () => void }) {
  const id = useId();
  const update = useUpdateInvestment();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [stepUp, setStepUp] = useState("");
  const [startDate, setStartDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isSip = investment?.kind === "sip";

  useEffect(() => {
    if (investment) {
      setAmount(String(investment.amount));
      setStepUp(investment.stepUpPercent ? String(investment.stepUpPercent) : "");
      setStartDate(investment.startDate);
      setError(null);
    }
  }, [investment]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!investment) return;
    const parsed = validateAmount(amount, "INR");
    if (parsed.error) return setError(parsed.error);

    try {
      await update.mutateAsync({
        id: investment.id,
        changes: { amount: parsed.amount!, startDate, ...(isSip && { stepUpPercent: Number(stepUp) || 0 }) }
      });
      toast("Saved — units were recalculated from published NAVs");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Dialog
      open={investment !== null}
      title={isSip ? "Edit SIP" : "Edit purchase"}
      description={isSip ? "Changes apply to every installment of this SIP, past and future." : undefined}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={id} loading={update.isPending}>Save</Button>
        </>
      }
    >
      <form id={id} className="dialog-body" onSubmit={submit} noValidate>
        {error && <div className="notice error" role="alert" style={{ margin: 0 }}>{error}</div>}
        <div className="grid-2">
          <Field label={isSip ? "Amount each month" : "Amount"} htmlFor={`${id}-amount`}>
            <MoneyInput id={`${id}-amount`} currency="INR" value={amount} onChange={setAmount} autoFocus />
          </Field>
          <Field label={isSip ? "First installment" : "Date invested"} htmlFor={`${id}-start`}>
            <input id={`${id}-start`} className="input mono" type="date" value={startDate} onChange={event => setStartDate(event.target.value)} />
          </Field>
        </div>
        {isSip && (
          <>
            <Field label="Yearly step-up" htmlFor={`${id}-step`}>
              <div className="affix">
                <input id={`${id}-step`} className="input mono" style={{ paddingLeft: 11, paddingRight: 30 }} inputMode="decimal" placeholder="0" value={stepUp} onChange={event => setStepUp(event.target.value.replace(/[^\d.]/g, ""))} />
                <span className="affix-end small">%</span>
              </div>
            </Field>
            <p className="hint">If your SIP amount changed partway through, stop this SIP on the date it changed and start a new one from then — that keeps every past installment exact.</p>
          </>
        )}
      </form>
    </Dialog>
  );
}

function ConfirmDialog({ confirm, onClose, data }: { confirm: Confirm | null; onClose: () => void; data: Detail }) {
  const navigate = useNavigate();
  const update = useUpdateInvestment();
  const removeInvestment = useDeleteInvestment();
  const removeHolding = useDeleteHolding();
  const toast = useToast();
  const name = data.holding.shortName;
  const busy = update.isPending || removeInvestment.isPending || removeHolding.isPending;
  // Errors stay inside the dialog, where the person is looking.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [confirm]);

  async function run() {
    if (!confirm) return;

    try {
      setError(null);
      if (confirm.type === "stop") {
        await update.mutateAsync({ id: confirm.investment.id, changes: { isActive: false } });
        toast(`SIP in ${name} stopped. Units you own stay in your portfolio.`);
        onClose();
      } else if (confirm.type === "delete-purchase") {
        const result = await removeInvestment.mutateAsync(confirm.investment.id);
        toast("Purchase deleted");
        onClose();
        if (result.remaining === 0) navigate("/investments");
      } else {
        await removeHolding.mutateAsync(String(data.holding.schemeCode));
        toast(`${name} removed from your portfolio`);
        onClose();
        navigate("/investments");
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const copy = !confirm ? null : confirm.type === "stop"
    ? {
      title: "Stop this SIP?",
      body: "No installments after today will be counted. Everything bought so far stays. This only changes Spendcast — cancel the mandate with your bank or fund house too.",
      action: "Stop SIP"
    }
    : confirm.type === "delete-purchase"
      ? {
        title: "Delete this purchase?",
        body: `The ${inr(confirm.investment.amount)} purchase on ${formatDate(confirm.investment.startDate)} and its ${formatUnits(confirm.investment.units)} units will be removed.`,
        action: "Delete purchase"
      }
      : {
        title: "Remove this fund?",
        body: `${name}, with all its SIPs and purchases (${data.holding.installmentsAllotted} recorded), will be removed from Spendcast. Your actual investment isn't affected.`,
        action: "Remove fund"
      };

  return (
    <Dialog
      open={confirm !== null}
      title={copy?.title ?? ""}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={confirm?.type === "stop" ? "primary" : "danger"} onClick={run} loading={busy}>{copy?.action}</Button>
        </>
      }
    >
      <div className="dialog-body" style={{ paddingBottom: 8 }}>
        {error && <div className="notice error" role="alert" style={{ margin: 0 }}>{error}</div>}
        <p className="ink-2">{copy?.body}</p>
      </div>
    </Dialog>
  );
}
