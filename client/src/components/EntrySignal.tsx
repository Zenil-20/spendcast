import type { EntrySignal as Signal, EntryZone } from "../lib/types";
import { formatDate, formatNav, formatPercent } from "../lib/format";

// Where today's NAV sits against the fund's own usual level, and how buying in
// each zone worked out over the following year in this fund's history.
// Descriptive, not a recommendation.

export const ZONE_LABELS: Record<EntryZone, { title: string; short: string; meaning: string }> = {
  below: { title: "Below usual", short: "Below usual today", meaning: "Each rupee buys more units than on most days." },
  usual: { title: "Around usual", short: "Around usual today", meaning: "The price is in its normal range." },
  above: { title: "Above usual", short: "Above usual today", meaning: "Each rupee buys fewer units than on most days." }
};

const ZONES: EntryZone[] = ["below", "usual", "above"];

export function ZoneBadge({ zone }: { zone: EntryZone }) {
  return (
    <span className={`zone-badge ${zone}`} title={ZONE_LABELS[zone].meaning}>
      <i aria-hidden="true" />{ZONE_LABELS[zone].short}
    </span>
  );
}

export function EntrySignalCard({ signal, nav }: { signal: Signal; nav: number }) {
  const label = ZONE_LABELS[signal.zone];
  const days = ZONES.reduce((sum, zone) => sum + (signal.history[zone]?.samples ?? 0), 0);
  const cheaperThan = Math.round((1 - signal.percentile) * 100);

  return (
    <section className={`entry-card ${signal.zone}`} aria-label="Today's price check">
      <div className="entry-head">
        <div>
          <div className="hero-label">Today's price check · {formatDate(signal.asOf, { day: "numeric", month: "short" })}</div>
          <div className="entry-title">{label.title}</div>
          <p className="small ink-2" style={{ marginTop: 4, maxWidth: "62ch" }}>
            NAV {formatNav(nav)} is {formatPercent(Math.abs(signal.deviation), { sign: false, digits: 1 })} {signal.deviation >= 0 ? "above" : "below"} its 200-day
            average of {formatNav(signal.average200)} — {signal.zone === "above"
              ? `higher than on ${Math.round(signal.percentile * 100)}% of days`
              : `lower than on ${cheaperThan}% of days`} since {formatDate(signal.since, { month: "short", year: "numeric" })}. {label.meaning}
          </p>
        </div>
        <div className="zone-scale" aria-hidden="true">
          {ZONES.map(zone => <span key={zone} className={zone === signal.zone ? "on" : ""}>{ZONE_LABELS[zone].title}</span>)}
          <i style={{ left: `${signal.percentile * 100}%` }} />
        </div>
      </div>

      <div className="entry-history">
        {ZONES.map(zone => {
          const outcome = signal.history[zone];
          return (
            <div key={zone} className={zone === signal.zone ? "current" : ""}>
              <div className="k">Bought on "{ZONE_LABELS[zone].title.toLowerCase()}" days</div>
              {outcome ? (
                <>
                  <div className="v">{formatPercent(outcome.averageReturn, { digits: 1 })}</div>
                  <div className="s">average over the next year · up {Math.round(outcome.positiveShare * 100)}% of the time</div>
                </>
              ) : <div className="s">Not enough history</div>}
            </div>
          );
        })}
      </div>

      <p className="disclaimer" style={{ marginTop: 10 }}>
        From this fund's own NAVs: {days.toLocaleString("en-IN")} trading days, each with the year that followed (periods overlap). Past
        patterns don't guarantee future returns, and a SIP keeps buying across all three zones. Not investment advice.
      </p>
    </section>
  );
}
