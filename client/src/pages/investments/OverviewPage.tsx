import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronRight, Info, TrendingDown, TrendingUp } from "lucide-react";
import { formatDate, formatMoney, formatPercent, signedMoney, tone } from "../../lib/format";
import type { Insight, Portfolio } from "../../lib/types";
import { rangeLabel, TIMELINE_RANGES, trimToRange, type TimelineRange } from "../../lib/series";
import { TimeChart } from "../../components/TimeChart";
import { TodayMoveCard } from "../../components/TodayMove";
import { AlertsPanel } from "../../components/AlertsPanel";
import { Segmented } from "../../components/ui";
import { SECTION_GROUPS, sectionUrl } from "./sections";

const inr = (value: number, style: "full" | "whole" | "compact" = "whole") => formatMoney(value, "INR", style);

// The one place for the headline numbers; other sections don't repeat them.
export function OverviewPage({ data }: { data: Portfolio }) {
  return (
    <div className="stack" style={{ gap: 28 }}>
      <SummaryCard data={data} />
      <AlertsPanel />
      {data.todayMove && <TodayMoveCard move={data.todayMove} />}
      {data.insights.length > 0 && (
        <div className="insights">
          {data.insights.map(insight => <InsightCard key={insight.id} insight={insight} />)}
        </div>
      )}
      <Explore />
    </div>
  );
}

// Every other section, grouped as in the menu.
function Explore() {
  return (
    <section aria-label="Explore your investments" className="stack" style={{ gap: 18 }}>
      {SECTION_GROUPS.map(group => {
        const sections = group.sections.filter(section => section.path);
        if (!sections.length) return null;
        return (
          <div key={group.id}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>{group.label}</div>
            <div className="explore-grid">
              {sections.map(section => (
                <Link key={section.path} to={sectionUrl(section)} className="explore-card">
                  <span className="ic"><section.icon size={16} /></span>
                  <span>
                    <span className="t">{section.label}</span>
                    <span className="d">{section.description}</span>
                  </span>
                  <ChevronRight size={15} className="ink-3" />
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </section>
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
