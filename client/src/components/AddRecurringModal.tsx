import { useEffect, useId, useState, type FormEvent } from "react";
import { useSettings } from "../lib/auth";
import { useCreateRecurring } from "../lib/queries";
import { formatMoney, ordinal, todayIn } from "../lib/format";
import { required, validateAmount } from "../lib/validation";
import { useToast } from "../lib/toast";
import type { Frequency } from "../lib/types";
import { Button, Dialog, Field, MoneyInput, Segmented } from "./ui";

const EMPTY = { title: "", amount: "", category: "", frequency: "monthly" as Frequency, startDate: "", endDate: "" };

function describeSchedule(frequency: Frequency, startDate: string): string {
  if (!startDate) return "";
  const day = Number(startDate.slice(8, 10));
  const month = new Intl.DateTimeFormat(undefined, { month: "long", timeZone: "UTC" }).format(new Date(`${startDate}T00:00:00Z`));

  if (frequency === "monthly") return `Every month on the ${ordinal(day)}${day > 28 ? " (or the last day of shorter months)" : ""}.`;
  if (frequency === "quarterly") return `Every three months on the ${ordinal(day)}, starting ${month}.`;
  return `Every year on ${ordinal(day)} ${month}.`;
}

export function AddRecurringModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const id = useId();
  const { timezone, currency } = useSettings();
  const toast = useToast();
  const createRecurring = useCreateRecurring();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY, startDate: todayIn(timezone) });
      setErrors({});
      setServerError(null);
    }
  }, [open, timezone]);

  const set = (field: keyof typeof EMPTY) => (value: string) => setForm(current => ({ ...current, [field]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const amount = validateAmount(form.amount, currency);
    const nextErrors = {
      title: required(form.title, "A name"),
      category: required(form.category, "A category"),
      amount: amount.error,
      startDate: form.startDate ? undefined : "Pick the first payment date.",
      endDate: form.endDate && form.endDate < form.startDate ? "It can't end before it starts." : undefined
    };
    setErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setServerError(null);
      await createRecurring.mutateAsync({
        title: form.title.trim(),
        amount: amount.amount!,
        category: form.category.trim(),
        frequency: form.frequency,
        startDate: form.startDate,
        endDate: form.endDate || null
      });
      toast(`${form.title.trim()} added · ${formatMoney(amount.amount!, currency)} ${form.frequency}`);
      onClose();
    } catch (error) {
      setServerError((error as Error).message);
    }
  }

  return (
    <Dialog
      open={open}
      title="New recurring payment"
      description="Rent, subscriptions, insurance — anything with a schedule."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={id} loading={createRecurring.isPending}>Save payment</Button>
        </>
      }
    >
      <form id={id} className="dialog-body" onSubmit={submit} noValidate>
        {serverError && <div className="notice error" role="alert" style={{ margin: 0 }}>{serverError}</div>}

        <Field label="Name" htmlFor={`${id}-title`} error={errors.title}>
          <input id={`${id}-title`} className="input" placeholder="Rent" value={form.title} aria-invalid={!!errors.title || undefined} onChange={event => set("title")(event.target.value)} maxLength={200} autoComplete="off" />
        </Field>

        <div className="grid-2">
          <Field label="Amount" htmlFor={`${id}-amount`} error={errors.amount}>
            <MoneyInput id={`${id}-amount`} currency={currency} value={form.amount} onChange={set("amount")} invalid={!!errors.amount} />
          </Field>
          <Field label="Category" htmlFor={`${id}-category`} error={errors.category}>
            <input id={`${id}-category`} className="input" placeholder="Housing" value={form.category} aria-invalid={!!errors.category || undefined} onChange={event => set("category")(event.target.value)} maxLength={100} autoComplete="off" />
          </Field>
        </div>

        <Field label="Repeats" hint={describeSchedule(form.frequency, form.startDate)}>
          <Segmented<Frequency>
            label="Frequency"
            value={form.frequency}
            onChange={value => setForm(current => ({ ...current, frequency: value }))}
            options={[
              { value: "monthly", label: "Monthly" },
              { value: "quarterly", label: "Quarterly" },
              { value: "yearly", label: "Yearly" }
            ]}
          />
        </Field>

        <div className="grid-2">
          <Field label="First payment" htmlFor={`${id}-start`} error={errors.startDate}>
            <input id={`${id}-start`} className="input mono" type="date" value={form.startDate} onChange={event => set("startDate")(event.target.value)} />
          </Field>
          <Field label="Last payment" htmlFor={`${id}-end`} error={errors.endDate} hint="Optional">
            <input id={`${id}-end`} className="input mono" type="date" min={form.startDate} value={form.endDate} onChange={event => set("endDate")(event.target.value)} />
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
