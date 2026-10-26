import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useSettings } from "../lib/auth";
import { useCreateExpense, useExpenses, useOptions, useRecurring } from "../lib/queries";
import { addDays, formatMoney, monthRange, todayIn } from "../lib/format";
import { required, validateAmount } from "../lib/validation";
import { useToast } from "../lib/toast";
import { Button, Dialog, Field, MoneyInput, Segmented } from "./ui";

const DEFAULT_CATEGORIES = ["Food", "Dining", "Transport", "Shopping", "Utilities", "Health"];
const METHOD_KEY = "spendcast.lastPaymentMethod";

function lastMethod(): string {
  try {
    return localStorage.getItem(METHOD_KEY) || "UPI";
  } catch {
    return "UPI";
  }
}

const EMPTY = { title: "", amount: "", category: "", date: "", paymentMethod: "UPI", notes: "", recurringExpenseId: "" };

export function AddExpenseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const id = useId();
  const { timezone, currency } = useSettings();
  const toast = useToast();
  const options = useOptions();
  const recurring = useRecurring();
  const createExpense = useCreateExpense();
  const today = todayIn(timezone);
  const { from } = monthRange(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  const recent = useExpenses(addDays(from, -45), today);

  const [form, setForm] = useState(EMPTY);
  const [showNotes, setShowNotes] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY, date: todayIn(timezone), paymentMethod: lastMethod() });
      setErrors({});
      setServerError(null);
      setShowNotes(false);
    }
  }, [open, timezone]);

  // The categories this person actually uses, most frequent first.
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    (recent.data ?? []).forEach(item => counts.set(item.category, (counts.get(item.category) ?? 0) + 1));
    const used = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    return [...new Set([...used, ...DEFAULT_CATEGORIES])].slice(0, 7);
  }, [recent.data]);

  const set = (field: keyof typeof EMPTY) => (value: string) => setForm(current => ({ ...current, [field]: value }));
  const activeRules = (recurring.data ?? []).filter(rule => rule.isActive && rule.currency === currency);
  const paymentMethods = options.data?.paymentMethods ?? ["Cash", "UPI", "Card", "Bank Transfer", "Other"];

  function linkRule(ruleId: string) {
    const rule = activeRules.find(item => item.id === ruleId);
    setForm(current => ({
      ...current,
      recurringExpenseId: ruleId,
      ...(rule && { title: rule.title, category: rule.category, amount: String(rule.amount) })
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const amount = validateAmount(form.amount, currency);
    const nextErrors = {
      amount: amount.error,
      title: required(form.title, "A description"),
      category: required(form.category, "A category"),
      date: !form.date ? "Pick a date." : form.date > today ? "That date hasn't happened yet." : undefined
    };
    setErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setServerError(null);
      await createExpense.mutateAsync({
        title: form.title.trim(),
        amount: amount.amount!,
        category: form.category.trim(),
        date: form.date,
        paymentMethod: form.paymentMethod,
        notes: form.notes.trim() || undefined,
        recurringExpenseId: form.recurringExpenseId || null
      });

      try {
        localStorage.setItem(METHOD_KEY, form.paymentMethod);
      } catch {
        /* not remembered next time */
      }

      toast(`Added ${formatMoney(amount.amount!, currency)} · ${form.title.trim()}`);
      onClose();
    } catch (error) {
      setServerError((error as Error).message);
    }
  }

  return (
    <Dialog
      open={open}
      title="New expense"
      description={`Recorded in ${currency}.`}
      onClose={onClose}
      footer={
        <>
          <span className="hint hide-sm"><kbd>Enter</kbd> to save</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={id} loading={createExpense.isPending}>Save expense</Button>
        </>
      }
    >
      <form id={id} className="dialog-body" onSubmit={submit} noValidate>
        {serverError && <div className="notice error" role="alert" style={{ margin: 0 }}>{serverError}</div>}

        <div className="grid-2">
          <Field label="Amount" htmlFor={`${id}-amount`} error={errors.amount}>
            <MoneyInput id={`${id}-amount`} currency={currency} value={form.amount} onChange={set("amount")} invalid={!!errors.amount} autoFocus />
          </Field>
          <Field label="Date" htmlFor={`${id}-date`} error={errors.date}>
            <input id={`${id}-date`} className="input mono" type="date" max={today} value={form.date} aria-invalid={!!errors.date || undefined} onChange={event => set("date")(event.target.value)} />
            <div className="row" style={{ gap: 12 }}>
              <button type="button" className="btn btn-link small" onClick={() => set("date")(today)}>Today</button>
              <button type="button" className="btn btn-link small" onClick={() => set("date")(addDays(today, -1))}>Yesterday</button>
            </div>
          </Field>
        </div>

        <Field label="What was it for?" htmlFor={`${id}-title`} error={errors.title}>
          <input id={`${id}-title`} className="input" placeholder="Weekly groceries" value={form.title} aria-invalid={!!errors.title || undefined} onChange={event => set("title")(event.target.value)} maxLength={200} autoComplete="off" />
        </Field>

        <Field label="Category" htmlFor={`${id}-category`} error={errors.category}>
          <div className="chips" style={{ marginBottom: 2 }}>
            {categories.map(category => (
              <button key={category} type="button" className="chip" aria-pressed={form.category === category} onClick={() => set("category")(category)}>
                {category}
              </button>
            ))}
          </div>
          <input id={`${id}-category`} className="input" placeholder="Or type a new one" value={form.category} aria-invalid={!!errors.category || undefined} onChange={event => set("category")(event.target.value)} maxLength={100} autoComplete="off" />
        </Field>

        <Field label="Paid with">
          <Segmented<string>
            label="Payment method"
            value={form.paymentMethod}
            onChange={set("paymentMethod")}
            options={paymentMethods.map(method => ({ value: method, label: method }))}
          />
        </Field>

        {activeRules.length > 0 && (
          <Field label="Part of a recurring payment?" htmlFor={`${id}-rule`} hint="Linking it means the bill won't be counted twice in your forecast.">
            <select id={`${id}-rule`} className="select" value={form.recurringExpenseId} onChange={event => linkRule(event.target.value)}>
              <option value="">No</option>
              {activeRules.map(rule => <option key={rule.id} value={rule.id}>{rule.title} · {formatMoney(rule.amount, rule.currency)}</option>)}
            </select>
          </Field>
        )}

        {showNotes ? (
          <Field label="Note" htmlFor={`${id}-notes`}>
            <textarea id={`${id}-notes`} className="textarea" value={form.notes} onChange={event => set("notes")(event.target.value)} maxLength={1000} autoFocus />
          </Field>
        ) : (
          <div><button type="button" className="btn btn-link small" onClick={() => setShowNotes(true)}>Add a note</button></div>
        )}
      </form>
    </Dialog>
  );
}
