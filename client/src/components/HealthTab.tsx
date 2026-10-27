import { useEffect, useId, useState, type FormEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { useHealth, useProfile, useSaveProfile } from "../lib/queries";
import { useToast } from "../lib/toast";
import { formatDate } from "../lib/format";
import type { HealthChange, HealthFactor, InvestmentProfile } from "../lib/types";
import { Button, Field, Segmented, Skeleton } from "./ui";

/*
 * Portfolio health: six measurable factors with the evidence behind each,
 * and every change to the score explained. A factor without enough data is
 * shown as not scored rather than guessed. It describes the portfolio's
 * structure, not its future returns.
 */

const BUCKETS = ["equity", "debt", "hybrid", "other"] as const;
const scoreTone = (score: number | null) => (score === null ? "" : score >= 70 ? "good" : score >= 45 ? "mid" : "low");
const points = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)} pts`;

export function HealthTab() {
  const health = useHealth();
  const [settingProfile, setSettingProfile] = useState(false);

  if (health.isPending) return <Skeleton height={320} />;
  if (health.isError) return <div className="notice error" role="alert"><AlertTriangle size={16} /><div>{health.error.message}</div></div>;
  const result = health.data.health;
  if (!result || result.score === null) return <p className="small ink-3">Add a fund to see your portfolio's health.</p>;

  const scored = result.factors.filter(f => f.score !== null).length;
  const needsProfile = result.factors.some(f => f.score === null && (f.key === "riskVsHorizon" || f.key === "allocationDrift"));

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="cards-2">
        <section className="card health-hero" aria-label="Health score">
          <div className={`health-score ${scoreTone(result.score)}`}>
            <span className="n">{result.score}</span><span className="of">/100</span>
          </div>
          <div className="health-grade">{result.grade}</div>
          <div className="odds-meter" aria-hidden="true"><span className={scoreTone(result.score)} style={{ width: `${result.score}%` }} /></div>
          <p className="small ink-2">
            From {scored} of {result.factors.length} factors ({Math.round(result.coverage * 100)}% of the full weight).
            Factors without enough data are left out, not guessed.
          </p>
          {needsProfile && (
            <Button variant="secondary" size="sm" onClick={() => setSettingProfile(true)}>Set your horizon and target</Button>
          )}
        </section>

        <ChangesCard changes={health.data.changes} />
      </div>

      <div className="health-factors">
        {result.factors.map(factor => <FactorCard key={factor.key} factor={factor} onSetProfile={() => setSettingProfile(true)} />)}
      </div>

      {settingProfile && <ProfileForm onDone={() => setSettingProfile(false)} />}

      <p className="disclaimer">
        The score describes how your portfolio is built today: concentration, overlap, risk for your horizon, costs, results
        against the Nifty 50, and drift from your own target. It is not a forecast and doesn't guarantee future returns. Not
        investment advice.
      </p>
    </div>
  );
}

function ChangesCard({ changes }: { changes: { sinceLast: HealthChange | null; sinceMonth: HealthChange | null } | null }) {
  const [period, setPeriod] = useState<"sinceLast" | "sinceMonth">("sinceLast");
  const change = changes?.[period] ?? null;

  return (
    <section className="card" aria-label="What changed">
      <div className="row between" style={{ alignItems: "start", gap: 12, marginBottom: 12 }}>
        <div>
          <h3>What changed</h3>
          <div className="sub" style={{ marginBottom: 0 }}>Every move in the score, with the evidence.</div>
        </div>
        <Segmented label="Compare with" value={period} onChange={setPeriod} options={[{ value: "sinceLast", label: "Last check" }, { value: "sinceMonth", label: "A month ago" }]} />
      </div>

      {!change && (
        <p className="small ink-3">
          {period === "sinceLast"
            ? "This is the first check. From the next one, every change to the score is explained here."
            : "Once there's a month of daily checks, changes over the month are explained here."}
        </p>
      )}

      {change && (
        <>
          <div className="health-delta">
            <span className="mono">{change.from} → {change.to}</span>
            <span className={change.change > 0 ? "up" : change.change < 0 ? "down" : "ink-3"}>{change.change > 0 ? "+" : ""}{change.change}</span>
            <span className="small ink-3">since {formatDate(change.date)}</span>
          </div>
          {change.reasons.length === 0 && <p className="small ink-3">Nothing moved the score by more than half a point.</p>}
          <ul className="reason-list">
            {change.reasons.map(reason => (
              <li key={reason.key}>
                <div className="row between" style={{ gap: 10 }}>
                  <span>{reason.text}</span>
                  <span className={`mono small ${reason.impact > 0 ? "up" : reason.impact < 0 ? "down" : "ink-3"}`}>{points(reason.impact)}</span>
                </div>
                {reason.details.length > 0 && <ul>{reason.details.map(detail => <li key={detail}>{detail}</li>)}</ul>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function FactorCard({ factor, onSetProfile }: { factor: HealthFactor; onSetProfile: () => void }) {
  const profileFactor = factor.key === "riskVsHorizon" || factor.key === "allocationDrift";

  return (
    <section className="card factor-card" aria-label={factor.label}>
      <div className="row between" style={{ gap: 10 }}>
        <h3>{factor.label}</h3>
        <span className="small ink-3">{Math.round(factor.weight * 100)}% of score</span>
      </div>

      {factor.score === null ? (
        <>
          <div className="factor-score ink-3">Not scored</div>
          <p className="small ink-2">{factor.reason}</p>
          {profileFactor && <div><Button variant="ghost" size="sm" onClick={onSetProfile}>Set it</Button></div>}
        </>
      ) : (
        <>
          <div className={`factor-score ${scoreTone(factor.score)}`}>{factor.score}<span className="ink-3">/100</span></div>
          <div className="odds-meter" aria-hidden="true"><span className={scoreTone(factor.score)} style={{ width: `${Math.max(2, factor.score)}%` }} /></div>
          <ul className="evidence-list">{factor.evidence.map(item => <li key={item}>{item}</li>)}</ul>
        </>
      )}
    </section>
  );
}

function ProfileForm({ onDone }: { onDone: () => void }) {
  const id = useId();
  const profile = useProfile();
  const save = useSaveProfile();
  const toast = useToast();
  const [horizon, setHorizon] = useState("");
  const [target, setTarget] = useState<Record<(typeof BUCKETS)[number], string>>({ equity: "", debt: "", hybrid: "", other: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile.data) return;
    setHorizon(profile.data.horizonYears !== null ? String(profile.data.horizonYears) : "");
    const allocation = profile.data.targetAllocation;
    if (allocation) setTarget({ equity: String(allocation.equity), debt: String(allocation.debt), hybrid: String(allocation.hybrid), other: String(allocation.other) });
  }, [profile.data]);

  const anyTarget = BUCKETS.some(bucket => target[bucket] !== "");
  const total = BUCKETS.reduce((sum, bucket) => sum + (Number(target[bucket]) || 0), 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const years = horizon === "" ? null : Number(horizon);
    if (years !== null && !(years >= 0.25 && years <= 50)) return setError("Use a horizon between 0.25 and 50 years, or leave it empty.");
    if (anyTarget && Math.abs(total - 100) > 0.5) return setError(`The target adds up to ${total}%. Make it 100%.`);

    const input: InvestmentProfile = {
      horizonYears: years,
      targetAllocation: anyTarget
        ? { equity: Number(target.equity) || 0, debt: Number(target.debt) || 0, hybrid: Number(target.hybrid) || 0, other: Number(target.other) || 0 }
        : null
    };
    try {
      await save.mutateAsync(input);
      toast.success("Saved. The score now uses your horizon and target.");
      onDone();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  return (
    <section className="card" aria-label="Horizon and target allocation">
      <h3>Your horizon and target</h3>
      <div className="sub">Risk is judged against when you need the money; drift against the mix you're aiming for. Without a horizon, your nearest goal's date is used.</div>
      <form id={id} onSubmit={submit} className="profile-form" noValidate>
        <Field label="Horizon (years)" htmlFor={`${id}-h`} hint="When you expect to need most of this money">
          <input id={`${id}-h`} className="input mono" inputMode="decimal" placeholder="e.g. 8" value={horizon} onChange={event => { setHorizon(event.target.value.replace(/[^\d.]/g, "")); setError(null); }} />
        </Field>
        <div className="field">
          <span className="label">Target allocation (%) {anyTarget && <span className={Math.abs(total - 100) > 0.5 ? "down" : "ink-3"}>· {total}%</span>}</span>
          <div className="alloc-inputs">
            {BUCKETS.map(bucket => (
              <label key={bucket} className="small ink-2">
                {bucket[0].toUpperCase() + bucket.slice(1)}
                <input className="input mono" inputMode="decimal" placeholder="0" value={target[bucket]} onChange={event => { setTarget(current => ({ ...current, [bucket]: event.target.value.replace(/[^\d.]/g, "") })); setError(null); }} />
              </label>
            ))}
          </div>
        </div>
        {error && <div className="notice error" role="alert">{error}</div>}
        <div className="row" style={{ gap: 8 }}>
          <Button variant="primary" type="submit" loading={save.isPending}>Save</Button>
          <Button variant="ghost" type="button" onClick={onDone}>Cancel</Button>
        </div>
      </form>
    </section>
  );
}
