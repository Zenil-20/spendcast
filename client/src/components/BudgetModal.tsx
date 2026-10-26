import { useEffect, useId, useState, type FormEvent } from "react";
import { useSettings } from "../lib/auth";
import { useSetBudget } from "../lib/queries";
import { formatMoney } from "../lib/format";
import { validateAmount } from "../lib/validation";
import { useToast } from "../lib/toast";
import { Button, Dialog, Field, MoneyInput } from "./ui";

export function BudgetModal({ open, onClose, current, typicalSpend }: {
  open: boolean;
  onClose: () => void;
  current: number | null;
  typicalSpend?: number;
}) {
  const id = useId();
  const { currency } = useSettings();
  const toast = useToast();
  const setBudget = useSetBudget();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (open) {
      setValue(current ? String(current) : "");
      setError(undefined);
    }
  }, [open, current]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = validateAmount(value, currency);

    if (result.error) {
      setError(result.error);
      return;
    }

    try {
      await setBudget.mutateAsync(result.amount!);
      toast(`Monthly budget set to ${formatMoney(result.amount!, currency, "whole")}`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Dialog
      open={open}
      title="Monthly budget"
      description="Every forecast is compared against this number."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={id} loading={setBudget.isPending}>Save budget</Button>
        </>
      }
    >
      <form id={id} className="dialog-body" onSubmit={submit} noValidate>
        <Field
          label={`Amount per month`}
          htmlFor={`${id}-amount`}
          error={error}
          hint={typicalSpend ? `You've typically spent about ${formatMoney(typicalSpend, currency, "whole")} a month.` : undefined}
        >
          <MoneyInput id={`${id}-amount`} currency={currency} value={value} onChange={setValue} invalid={!!error} autoFocus />
        </Field>
      </form>
    </Dialog>
  );
}
