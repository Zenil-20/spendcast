import { useEffect, useId, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "../lib/api";
import { useCreateInvestment, useFund, useFundSearch } from "../lib/queries";
import { formatDate, formatMoney, formatNav, formatPercent, formatUnits, ordinal, todayIn } from "../lib/format";
import { validateAmount } from "../lib/validation";
import { useToast } from "../lib/toast";
import { useDebounced } from "../lib/hooks";
import type { InvestmentInput, InvestmentKind, InvestmentPreview, SchemeSearchResult } from "../lib/types";
import { Button, Dialog, Field, MoneyInput, Segmented, Skeleton } from "./ui";

const MARKET_TZ = "Asia/Kolkata";

// Adds a SIP or one-time purchase. From a fund page it opens on that fund
// (`initialFund`) with the kind fixed (`lockedKind`): "Add extra purchase"
// and "Start a SIP".
export function AddInvestmentModal({ open, onClose, initialFund = null, lockedKind = null }: {
  open: boolean;
  onClose: () => void;
  initialFund?: SchemeSearchResult | null;
  lockedKind?: InvestmentKind | null;
}) {
  const [fund, setFund] = useState<SchemeSearchResult | null>(initialFund);

  useEffect(() => {
    if (open) setFund(initialFund);
  }, [open, initialFund]);

  const title = !fund
    ? "Find your fund"
    : lockedKind === "lumpsum"
      ? "Add extra purchase"
      : lockedKind === "sip"
        ? "Start a SIP"
        : "Add your investment";

  return (
    <Dialog
      open={open}
      title={title}
      description={fund ? undefined : "Search by fund name, scheme code or ISIN."}
      onClose={onClose}
    >
      {fund
        ? <InvestmentForm fund={fund} lockedKind={lockedKind} onBack={initialFund ? null : () => setFund(null)} onDone={onClose} />
        : <FundPicker onPick={setFund} />}
    </Dialog>
  );
}

function FundPicker({ onPick }: { onPick: (fund: SchemeSearchResult) => void }) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const debounced = useDebounced(query, 220);
  const search = useFundSearch(debounced);
  const searching = debounced.trim().length >= 2;
  const results = searching ? search.data?.results ?? [] : [];
  const match = searching ? search.data?.match ?? "none" : "none";

  useEffect(() => setActive(0), [debounced]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(index => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(index => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      onPick(results[active]);
    }
  }

  return (
    <div className="dialog-body" style={{ paddingBottom: 22 }}>
      <div className="affix">
        <span className="affix-start" style={{ display: "grid" }}><Search size={14} /></span>
        <input
          className="input"
          data-autofocus
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          placeholder="e.g. Parag Parikh Flexi Cap, 122639, INF879O01027"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {search.isFetching && <span className="affix-end"><span className="spinner" /></span>}
      </div>

      {searching && !search.isFetching && results.length === 0 && (
        <p className="ink-2 small">
          Nothing found for "{debounced}". Try the fund house and category (e.g. "nippon small cap"), or the scheme code from your statement.
        </p>
      )}

      {results.length > 0 && (match === "fuzzy" || match === "partial") && (
        <p className="small ink-3" role="status">
          {match === "fuzzy" ? "Showing results for a close spelling." : `No fund has every word of "${debounced}" — showing the closest matches.`}
        </p>
      )}

      {results.length > 0 && (
        <ul className="results" id={listId} role="listbox">
          {results.map((fund, index) => (
            <li
              key={fund.schemeCode}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={event => { event.preventDefault(); onPick(fund); }}
            >
              <div>{fund.schemeName}</div>
              <div className="meta">{fund.schemeCode}{fund.isinGrowth ? ` · ${fund.isinGrowth}` : ""}</div>
            </li>
          ))}
        </ul>
      )}

      {debounced.trim().length < 2 && (
        <p className="hint">
          Tip: your scheme code and ISIN are printed on your account statement. Direct and growth plans are listed first.
        </p>
      )}
    </div>
  );
}

function InvestmentForm({ fund, lockedKind, onBack, onDone }: {
  fund: SchemeSearchResult;
  lockedKind: InvestmentKind | null;
  onBack: (() => void) | null;
  onDone: () => void;
}) {
  const id = useId();
  const navigate = useNavigate();
  const toast = useToast();
  const details = useFund(fund.schemeCode);
  const create = useCreateInvestment();
  const today = todayIn(MARKET_TZ);

  const [kind, setKind] = useState<InvestmentKind>(lockedKind ?? "sip");
  const [amount, setAmount] = useState("");
  const [sipDay, setSipDay] = useState(15);
  const [startDate, setStartDate] = useState("");
  const [stepUp, setStepUp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvestmentPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const firstNav = details.data?.firstNavDate ?? undefined;

  const input = useMemo<InvestmentInput | null>(() => {
    const parsed = validateAmount(amount, "INR");
    if (parsed.error || !startDate) return null;
    if (kind === "lumpsum" && startDate > today) return null;
    return {
      schemeCode: fund.schemeCode,
      kind,
      amount: parsed.amount!,
      startDate,
      ...(kind === "sip" && { sipDay, stepUpPercent: Number(stepUp) || 0 })
    };
  }, [amount, startDate, kind, sipDay, stepUp, fund.schemeCode, today]);

  const debouncedInput = useDebounced(input, 400);

  // Live preview of every installment so far, worked out from real NAVs.
  useEffect(() => {
    if (!debouncedInput) {
      setPreview(null);
      setPreviewError(null);
      return;
    }

    let cancelled = false;
    setPreviewing(true);
    api.previewInvestment(debouncedInput)
      .then(result => { if (!cancelled) { setPreview(result.preview); setPreviewError(null); } })
      .catch(err => { if (!cancelled) { setPreview(null); setPreviewError((err as Error).message); } })
      .finally(() => { if (!cancelled) setPreviewing(false); });

    return () => { cancelled = true; };
  }, [debouncedInput]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = validateAmount(amount, "INR");

    if (parsed.error) return setError(parsed.error);
    if (!startDate) return setError(kind === "sip" ? "When did this SIP start?" : "When did you invest?");
    if (!input) return setError("Check the details above.");

    try {
      setError(null);
      const result = await create.mutateAsync(input);
      const name = fund.schemeName.split(" - ")[0];
      toast(lockedKind === "lumpsum" ? `Extra purchase added to ${name}` : lockedKind === "sip" ? `SIP started in ${name}` : `${name} added to your portfolio`);
      onDone();
      navigate(`/investments/${result.holding.schemeCode}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="dialog-body">
        <div className="row between" style={{ alignItems: "start", gap: 16 }}>
          <div>
            <div className="fund-name">{fund.schemeName}</div>
            {details.isPending ? (
              <Skeleton height={12} width={220} style={{ marginTop: 6 }} />
            ) : details.data ? (
              <div className="small ink-3" style={{ marginTop: 3 }}>
                {details.data.meta.fundHouse} · {details.data.category} · NAV {formatNav(details.data.latestNav?.nav)} on{" "}
                {details.data.latestNav && formatDate(details.data.latestNav.date, { day: "numeric", month: "short" })}
              </div>
            ) : (
              <div className="small error-text" style={{ marginTop: 3 }}>{details.error?.message}</div>
            )}
          </div>
          {onBack && <button type="button" className="btn btn-link small" onClick={onBack}>Change</button>}
        </div>

        {!lockedKind && (
          <Field label="How do you invest?">
            <Segmented<InvestmentKind>
              label="Investment type"
              value={kind}
              onChange={setKind}
              options={[{ value: "sip", label: "Monthly SIP" }, { value: "lumpsum", label: "One-time" }]}
            />
          </Field>
        )}

        <div className="grid-2">
          <Field label={kind === "sip" ? "Amount each month" : lockedKind === "lumpsum" ? "Amount of this purchase" : "Amount invested"} htmlFor={`${id}-amount`}>
            <MoneyInput id={`${id}-amount`} currency="INR" value={amount} onChange={setAmount} autoFocus />
          </Field>
          {kind === "sip" ? (
            <Field label="SIP date" htmlFor={`${id}-day`} hint={sipDay > 28 ? "Shorter months use their last day." : undefined}>
              <select id={`${id}-day`} className="select" value={sipDay} onChange={event => setSipDay(Number(event.target.value))}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(day => <option key={day} value={day}>{ordinal(day)} of every month</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Date invested" htmlFor={`${id}-date`} hint="If the market was closed that day, the next trading day's NAV is used.">
              <input id={`${id}-date`} className="input mono" type="date" min={firstNav} max={today} value={startDate} onChange={event => setStartDate(event.target.value)} />
            </Field>
          )}
        </div>

        {kind === "sip" && (
          <div className="grid-2">
            <Field label="First installment" htmlFor={`${id}-start`} hint={firstNav ? `NAV history from ${formatDate(firstNav)}` : undefined}>
              <input id={`${id}-start`} className="input mono" type="date" min={firstNav} value={startDate} onChange={event => setStartDate(event.target.value)} />
            </Field>
            <Field label="Yearly step-up (optional)" htmlFor={`${id}-step`} hint="e.g. 10 raises it by 10% each year">
              <div className="affix">
                <input id={`${id}-step`} className="input mono" style={{ paddingLeft: 11, paddingRight: 30 }} inputMode="decimal" placeholder="0" value={stepUp} onChange={event => setStepUp(event.target.value.replace(/[^\d.]/g, ""))} />
                <span className="affix-end small">%</span>
              </div>
            </Field>
          </div>
        )}

        <PreviewPanel kind={kind} preview={preview} error={previewError} loading={previewing} />

        {error && <div className="notice error" role="alert" style={{ margin: 0 }}>{error}</div>}
      </div>

      <div className="dialog-foot">
        <span className="hint hide-sm">Units are worked out from published NAVs.</span>
        <Button variant="ghost" type="button" onClick={onDone}>Cancel</Button>
        <Button variant="primary" type="submit" loading={create.isPending} disabled={!input}>{lockedKind === "lumpsum" ? "Add purchase" : lockedKind === "sip" ? "Start SIP" : "Add to portfolio"}</Button>
      </div>
    </form>
  );
}

function PreviewPanel({ kind, preview, error, loading }: { kind: InvestmentKind; preview: InvestmentPreview | null; error: string | null; loading: boolean }) {
  if (error) {
    return <div className="notice error" style={{ margin: 0 }}>{error}</div>;
  }

  if (!preview) {
    return (
      <div className="preview ink-3">
        {loading ? "Working out your units from past NAVs…" : "Fill in the amount and date to see exactly what you own."}
      </div>
    );
  }

  const inr = (value: number) => formatMoney(value, "INR", "whole");

  if (kind === "lumpsum" && preview.firstAllotment) {
    const allotment = preview.firstAllotment;
    return (
      <div className="preview" style={{ opacity: loading ? 0.6 : 1 }}>
        <div className="big">
          {formatUnits(allotment.units)} units at {formatNav(allotment.nav)}, now worth {inr(preview.value)}{" "}
          <span className={preview.gain >= 0 ? "up" : "down"}>({formatPercent(preview.absoluteReturn)})</span>.
        </div>
        {allotment.shifted && (
          <div className="ink-2" style={{ marginTop: 6 }}>
            {formatDate(allotment.dueDate, { weekday: "long", day: "numeric", month: "short" })} was not a trading day, so the purchase used the NAV of {formatDate(allotment.navDate!, { weekday: "long", day: "numeric", month: "short" })}.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="preview" style={{ opacity: loading ? 0.6 : 1 }}>
      {preview.installmentsAllotted === 0 ? (
        <div className="big">
          {preview.awaitingNav ? "The first installment is due; its units appear once that day's NAV is published." : "No installments yet."}
          {preview.next && ` Next: ${formatDate(preview.next.dueDate, { day: "numeric", month: "short" })}.`}
        </div>
      ) : (
        <>
          <div className="big">
            {preview.installmentsAllotted} installment{preview.installmentsAllotted === 1 ? "" : "s"} so far — {inr(preview.invested)} invested,{" "}
            {formatUnits(preview.units)} units, worth {inr(preview.value)}{" "}
            <span className={preview.gain >= 0 ? "up" : "down"}>({formatPercent(preview.absoluteReturn)})</span>.
          </div>
          {preview.shiftedCount > 0 && (
            <div className="ink-2" style={{ marginTop: 6 }}>
              {preview.shiftedCount} fell on a weekend or market holiday and {preview.shiftedCount === 1 ? "was" : "were"} bought at the next trading day's NAV, as your fund house does.
            </div>
          )}
          {preview.next && (
            <div className="ink-3 small" style={{ marginTop: 6 }}>
              Next installment {formatDate(preview.next.dueDate, { weekday: "short", day: "numeric", month: "short" })} · {inr(preview.next.amount)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
