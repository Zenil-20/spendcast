import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Pencil, Plus, Target, Trash2 } from "lucide-react";
import { useDeleteGoal, useGoalPreview, useGoals, useSaveGoal } from "../lib/queries";
import { useDebounced } from "../lib/hooks";
import { useToast } from "../lib/toast";
import { addDays, formatDate, formatMoney, formatPercent, todayIn } from "../lib/format";
import type { Goal, GoalInput, Holding } from "../lib/types";
import { TimeChart } from "./TimeChart";
import { Button, Dialog, Field, MoneyInput, Segmented, Skeleton } from "./ui";

/*
 * Goals: "₹25 lakh by 2032 — what are my chances?" The odds come from
 * replaying the chosen funds' real monthly returns (see mfPlanning), not from
 * an assumed fixed rate.
 */

const MARKET_TZ = "Asia/Kolkata";
const inr = (value: number, style: "full" | "whole" | "compact" = "whole") => formatMoney(value, "INR", style);

export function oddsLabel(probability: number): string {
  if (probability >= 0.85) return "Very likely";
  if (probability >= 0.6) return "Likely";
  if (probability >= 0.3) return "Possible";
  if (probability >= 0.1) return "Unlikely";
  return "Very unlikely";
}

const oddsTone = (probability: number) => (probability >= 0.6 ? "good" : probability >= 0.3 ? "mid" : "low");

function yearsUntil(today: string, date: string): string {
  const months = Math.max(0, (Number(date.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(date.slice(5, 7)) - Number(today.slice(5, 7)));
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years ? `${years} year${years === 1 ? "" : "s"}` : "", rest ? `${rest} month${rest === 1 ? "" : "s"}` : ""].filter(Boolean).join(" ") || "under a month";
}

export function GoalsTab({ holdings }: { holdings: Holding[] }) {
  const goals = useGoals();
  const [editing, setEditing] = useState<Goal | "new" | null>(null);

  return (
    <div className="goals">
      <div className="list-toolbar">
        <span className="small ink-3">
          Your chances of reaching each goal, from {holdings.length ? "your funds'" : "the Nifty 50's"} real past returns — not an assumed 12% a year.
        </span>
        <Button variant="secondary" icon={<Plus size={15} />} onClick={() => setEditing("new")}>New goal</Button>
      </div>

      {goals.isPending && <Skeleton height={320} />}
      {goals.isError && <div className="notice error" role="alert">{goals.error.message}</div>}

      {goals.data?.length === 0 && (
        <div className="summary-card goal-empty">
          <Target size={22} className="ink-3" />
          <h3 className="display" style={{ fontSize: 24 }}>What are you saving for?</h3>
          <p className="ink-2" style={{ maxWidth: "58ch" }}>
            A house, a car, your child's education. Set an amount and a date, and see how often your funds' actual history would
            have got you there — plus what monthly amount would make it likely.
          </p>
          <div><Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing("new")}>Set a goal</Button></div>
        </div>
      )}

      {goals.data?.map(goal => <GoalCard key={goal.id} goal={goal} onEdit={() => setEditing(goal)} />)}

      {editing && <GoalDialog goal={editing === "new" ? null : editing} holdings={holdings} onClose={() => setEditing(null)} />}
    </div>
  );
}

function GoalCard({ goal, onEdit }: { goal: Goal; onEdit: () => void }) {
  const remove = useDeleteGoal();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const sim = goal.simulation;

  async function onDelete() {
    try {
      await remove.mutateAsync(goal.id!);
      toast.success(`Deleted "${goal.name}"`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <section className="card goal-card" aria-label={goal.name}>
      <div className="goal-head">
        <div style={{ minWidth: 0 }}>
          <h3 style={{ marginBottom: 2 }}>{goal.name}</h3>
          <div className="small ink-2">
            {inr(goal.targetAmount)} by {formatDate(goal.targetDate, { month: "short", year: "numeric" })} · in {yearsUntil(goal.today, goal.targetDate)}
          </div>
          <div className="small ink-3" style={{ marginTop: 2 }}>
            {inr(goal.effectiveMonthly)}/month{goal.stepUpPercent > 0 && `, +${goal.stepUpPercent}% a year`}
            {goal.monthlyContribution === null ? " (your current SIPs)" : ""} · {goal.schemeCodes.length ? goal.funds.map(f => f.shortName).join(", ") || "funds no longer held" : "all your funds"}
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <Button variant="ghost" size="sm" icon={<Pencil size={14} />} onClick={onEdit}>Edit</Button>
          <Button variant="ghost" size="sm" iconOnly aria-label={`Delete goal ${goal.name}`} icon={<Trash2 size={14} />} onClick={() => setConfirming(true)} />
        </div>
      </div>

      {sim ? <GoalResult goal={goal} /> : <p className="small ink-2">The target date has passed. Edit the goal to set a new date.</p>}

      <Dialog
        open={confirming}
        title={`Delete "${goal.name}"?`}
        description="Only the goal is removed. Your funds and SIPs stay as they are."
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={async () => { await onDelete(); setConfirming(false); }}>Delete goal</Button>
          </>
        }
      >
        {null}
      </Dialog>
    </section>
  );
}

// The odds, the range of outcomes over time, and what it takes to make it likely.
function GoalResult({ goal, compact = false }: { goal: Goal; compact?: boolean }) {
  const sim = goal.simulation!;
  const percent = Math.round(sim.probability * 100);
  const start = { date: goal.today, value: sim.current };
  const series = useMemo(() => [
    { key: "median", label: "Typical outcome", color: "var(--series-recurring)", shape: "smooth" as const, area: true, points: [start, ...sim.fan.map(p => ({ date: p.date, value: p.median }))] },
    { key: "p90", label: "Good markets (top 10%)", color: "var(--chart-3)", shape: "smooth" as const, points: [start, ...sim.fan.map(p => ({ date: p.date, value: p.p90 }))] },
    { key: "p10", label: "Bad markets (bottom 10%)", color: "var(--chart-2)", shape: "smooth" as const, points: [start, ...sim.fan.map(p => ({ date: p.date, value: p.p10 }))] },
    { key: "target", label: "Target", color: "var(--ink-2)", shape: "line" as const, points: [{ date: goal.today, value: goal.targetAmount }, { date: sim.fan[sim.fan.length - 1].date, value: goal.targetAmount }] }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [sim, goal.today, goal.targetAmount]);
  const younger = goal.funds.filter(fund => fund.historyMonths !== null && fund.historyMonths < sim.history.months * 0.9);
  const flatGap = sim.outcomes.median / sim.flatRate.value - 1;

  return (
    <div className="goal-result">
      <div className="goal-odds">
        <div className={`odds-figure ${oddsTone(sim.probability)}`}>
          <span className="pct">{percent < 1 && sim.probability > 0 ? "<1" : percent}%</span>
          <span className="lbl">{oddsLabel(sim.probability)}</span>
        </div>
        <div className="odds-meter" aria-hidden="true"><span className={oddsTone(sim.probability)} style={{ width: `${Math.max(1, percent)}%` }} /></div>
        <div className="small ink-2">
          of {sim.history.paths.toLocaleString("en-IN")} replays of past markets reached {inr(goal.targetAmount, "compact")}.
        </div>

        <dl className="kv-list" style={{ marginTop: 14 }}>
          <dt>Typical outcome</dt><dd>{inr(sim.outcomes.median, "compact")}</dd>
          <dt>1 in 10 ended below</dt><dd>{inr(sim.outcomes.p10, "compact")}</dd>
          <dt>You put in</dt><dd>{inr(sim.totalInvested, "compact")}</dd>
          {sim.probability < 0.75 && sim.neededMonthly.odds75 !== null && (
            <>
              <dt className="total">For a 75% chance</dt>
              <dd className="total">{inr(sim.neededMonthly.odds75)}/month</dd>
            </>
          )}
          {sim.probability < 0.5 && sim.neededMonthly.odds50 !== null && (
            <>
              <dt>For even odds</dt>
              <dd>{inr(sim.neededMonthly.odds50)}/month</dd>
            </>
          )}
        </dl>
      </div>

      {!compact && (
        <div className="goal-chart">
          <TimeChart
            ariaLabel={`Projected value of ${goal.name}: typical, good and bad markets against the target`}
            height={240}
            fromZero
            series={series}
            initiallyHidden={[]}
            formatAxis={value => inr(value, "compact")}
            renderReadout={({ date, values }) => (
              <>
                <span className="r-date">{formatDate(date, { month: "short", year: "numeric" })}</span>
                {series.filter(s => values[s.key] !== undefined && s.key !== "target").map(s => (
                  <span className="r-item" key={s.key}><i style={{ background: s.color }} />{s.label} <b>{inr(values[s.key]!, "compact")}</b></span>
                ))}
              </>
            )}
          />
        </div>
      )}

      {!compact && (
        <p className="disclaimer goal-foot">
          A calculator assuming a flat {formatPercent(sim.flatRate.rate, { sign: false, digits: 0 })} a year would promise {inr(sim.flatRate.value, "compact")}
          {Math.abs(flatGap) >= 0.02 && ` — ${flatGap > 0 ? "less" : "more"} than the typical replay`}, and never shows the bad years.
          {" "}Built from {sim.history.months} months of real monthly returns ({formatDate(`${sim.history.from}-01`, { month: "short", year: "numeric" })} – {formatDate(`${sim.history.to}-01`, { month: "short", year: "numeric" })})
          {goal.funds.length ? " of the chosen funds" : ` of ${goal.benchmarkName ?? "the Nifty 50"}`}, replayed in {sim.history.blockMonths}-month stretches so real crashes and recoveries stay intact.
          {younger.length > 0 && ` ${younger.map(f => f.shortName).join(", ")} ${younger.length === 1 ? "is" : "are"} newer than that, so Nifty 50 returns stand in for the months before ${younger.length === 1 ? "it" : "they"} existed.`}
          {" "}Past markets don't guarantee future ones. Not investment advice.
        </p>
      )}
    </div>
  );
}

type ContributionMode = "sips" | "amount";

function GoalDialog({ goal, holdings, onClose }: { goal: Goal | null; holdings: Holding[]; onClose: () => void }) {
  const id = useId();
  const today = todayIn(MARKET_TZ);
  const save = useSaveGoal();
  const toast = useToast();

  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? String(goal.targetAmount) : "");
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? addDays(today, 365 * 5));
  const [picked, setPicked] = useState<number[]>(goal?.schemeCodes ?? []);
  const [mode, setMode] = useState<ContributionMode>(goal?.monthlyContribution != null ? "amount" : "sips");
  const [monthly, setMonthly] = useState(goal?.monthlyContribution != null ? String(goal.monthlyContribution) : "");
  const [stepUp, setStepUp] = useState(goal?.stepUpPercent ? String(goal.stepUpPercent) : "");
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const chosen = picked.length ? holdings.filter(h => picked.includes(h.schemeCode)) : holdings;
  const currentSips = chosen.reduce((sum, h) => sum + h.monthlySip, 0);

  const errors = {
    name: !name.trim() ? "Give the goal a name." : null,
    target: !(Number(target) >= 1000) ? "Enter a target of at least ₹1,000." : null,
    date: !targetDate || targetDate < addDays(today, 31) ? "Choose a date at least a month away." : targetDate > addDays(today, 365 * 40) ? "Choose a date within 40 years." : null,
    monthly: mode === "amount" && !(Number(monthly) >= 0 && monthly !== "") ? "Enter a monthly amount, or use your current SIPs." : null,
    stepUp: stepUp !== "" && !(Number(stepUp) >= 0 && Number(stepUp) <= 50) ? "Use 0 to 50%." : null
  };
  const valid = Object.values(errors).every(error => !error);

  const input: GoalInput | null = valid
    ? {
      name: name.trim(),
      targetAmount: Number(target),
      targetDate,
      schemeCodes: picked,
      monthlyContribution: mode === "amount" ? Math.round(Number(monthly)) : null,
      stepUpPercent: Number(stepUp) || 0
    }
    : null;
  // The preview ignores the name, so renaming doesn't re-run it.
  const previewInput = useDebounced(input && { ...input, name: "preview" }, 400);
  const preview = useGoalPreview(previewInput);

  useEffect(() => setSaveError(null), [name, target, targetDate, picked, mode, monthly, stepUp]);

  function toggle(code: number) {
    setPicked(current => (current.includes(code) ? current.filter(c => c !== code) : [...current, code]));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!input) return;
    try {
      await save.mutateAsync({ id: goal?.id ?? null, input });
      toast.success(goal ? `Updated "${input.name}"` : `Added "${input.name}"`);
      onClose();
    } catch (error) {
      setSaveError((error as Error).message);
    }
  }

  const show = (error: string | null) => (submitted ? error : null);

  return (
    <Dialog
      open
      title={goal ? "Edit goal" : "New goal"}
      description="See your chances as you type."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={id} loading={save.isPending}>{goal ? "Save" : "Add goal"}</Button>
        </>
      }
    >
      <form id={id} onSubmit={submit} className="dialog-body goal-form" noValidate>
        <Field label="Goal" htmlFor={`${id}-name`} error={show(errors.name)}>
          <input id={`${id}-name`} className="input" maxLength={60} placeholder="e.g. House down payment" value={name} autoFocus onChange={event => setName(event.target.value)} />
        </Field>

        <div className="grid-2">
          <Field label="Target amount" htmlFor={`${id}-target`} error={show(errors.target)} hint={Number(target) >= 1000 ? inr(Number(target), "compact") : undefined}>
            <MoneyInput id={`${id}-target`} currency="INR" value={target} onChange={setTarget} invalid={!!show(errors.target)} />
          </Field>
          <Field label="By" htmlFor={`${id}-date`} error={show(errors.date)} hint={!errors.date ? `In ${yearsUntil(today, targetDate)}` : undefined}>
            <input id={`${id}-date`} className="input mono" type="date" min={addDays(today, 31)} value={targetDate} onChange={event => setTargetDate(event.target.value)} />
          </Field>
        </div>

        {holdings.length > 0 && (
          <div className="field">
            <span className="label">Funds that count towards it</span>
            <div className="fund-chips" role="group" aria-label="Funds for this goal">
              <button type="button" className="fund-chip" aria-pressed={picked.length === 0} onClick={() => setPicked([])}><i /><span>All my funds</span></button>
              {holdings.map(holding => (
                <button key={holding.schemeCode} type="button" className="fund-chip" aria-pressed={picked.includes(holding.schemeCode)} onClick={() => toggle(holding.schemeCode)} title={holding.schemeName}>
                  <i /><span>{holding.shortName}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <span className="label">Each month</span>
          <Segmented<ContributionMode>
            label="Monthly amount"
            value={mode}
            onChange={setMode}
            options={[{ value: "sips", label: `My current SIPs · ${inr(currentSips)}` }, { value: "amount", label: "A set amount" }]}
          />
        </div>

        <div className="grid-2">
          {mode === "amount" && (
            <Field label="Monthly amount" htmlFor={`${id}-monthly`} error={show(errors.monthly)}>
              <MoneyInput id={`${id}-monthly`} currency="INR" value={monthly} onChange={setMonthly} invalid={!!show(errors.monthly)} />
            </Field>
          )}
          <Field label="Yearly step-up (optional)" htmlFor={`${id}-step`} error={show(errors.stepUp)} hint="e.g. 10 raises it by 10% each year">
            <div className="affix">
              <input id={`${id}-step`} className="input mono" style={{ paddingLeft: 11, paddingRight: 30 }} inputMode="decimal" placeholder="0" value={stepUp} onChange={event => setStepUp(event.target.value.replace(/[^\d.]/g, ""))} />
              <span className="affix-end small">%</span>
            </div>
          </Field>
        </div>

        <div className="goal-preview" aria-live="polite">
          {!input && <span className="small ink-3">Fill in the amount and date to see your chances.</span>}
          {input && preview.isError && <span className="small" style={{ color: "var(--critical)" }}>{preview.error.message}</span>}
          {input && preview.isPending && <Skeleton height={60} />}
          {input && preview.data?.simulation && !preview.isError && (
            <div className={preview.isFetching ? "refreshing" : ""}>
              <GoalResult goal={{ ...preview.data, name: input.name || "this goal" }} compact />
            </div>
          )}
        </div>

        {saveError && <div className="notice error" role="alert">{saveError}</div>}
      </form>
    </Dialog>
  );
}
