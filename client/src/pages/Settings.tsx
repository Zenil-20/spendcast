import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useBudget, useOptions } from "../lib/queries";
import { formatInstant, formatMoney, zoneAbbreviation } from "../lib/format";
import { useTheme, type ThemeChoice } from "../lib/theme";
import { useToast } from "../lib/toast";
import { Button, ComboBox, Field, Segmented } from "../components/ui";
import { BudgetModal } from "../components/BudgetModal";

const currencyNames = new Intl.DisplayNames(undefined, { type: "currency" });

function currencyLabel(code: string) {
  try {
    return `${code} — ${currencyNames.of(code)}`;
  } catch {
    return code;
  }
}

function timeZoneLabel(zone: string) {
  return zone.replace(/_/g, " ");
}

export function Settings() {
  const { user, setUser, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const options = useOptions();
  const budget = useBudget();
  const [editingBudget, setEditingBudget] = useState(false);
  const current = user!.settings;
  const pending = user!.pendingChange;
  const target = pending ?? current;
  const [timezone, setTimezone] = useState(target.timezone);
  const [currency, setCurrency] = useState(target.currency);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTimezone(target.timezone);
    setCurrency(target.currency);
  }, [target.timezone, target.currency]);

  const dirty = timezone !== target.timezone || currency !== target.currency;
  const currencyChanging = currency !== current.currency;

  async function save(changes: { timezone: string; currency: string }) {
    if (!(options.data?.timezones ?? []).includes(changes.timezone) || !(options.data?.currencies ?? []).includes(changes.currency)) {
      setError("Choose a timezone and a currency from the lists.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const result = await api.updateSettings(changes);
      setUser({ ...user!, ...result });
      toast(result.pendingChange ? "Saved — it takes effect at midnight" : "Scheduled change cancelled");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Settings</div>
          <h1 className="title" style={{ marginTop: 6 }}>Your account</h1>
        </div>
      </div>

      <div className="settings-group" style={{ maxWidth: 880 }}>
        <div className="setting">
          <div>
            <h2 className="heading" style={{ fontSize: 17 }}>Profile</h2>
            <p className="desc">The name and email on this account.</p>
          </div>
          <div className="control">
            <div>
              <div style={{ fontWeight: 600 }}>{user!.name}</div>
              <div className="ink-2">{user!.email}</div>
            </div>
          </div>
        </div>

        <div className="setting">
          <div>
            <h2 className="heading" style={{ fontSize: 17 }}>Region</h2>
            <p className="desc">
              Dates follow your timezone and amounts your currency. A change starts at the next midnight
              ({zoneAbbreviation(current.timezone)}), so today's numbers stay consistent.
            </p>
          </div>
          <div className="control">
            {pending && (
              <div className="notice" style={{ margin: 0 }}>
                <div style={{ flex: 1 }}>
                  Switching to <strong>{timeZoneLabel(pending.timezone)}</strong> and <strong>{pending.currency}</strong> on{" "}
                  {formatInstant(pending.effectiveAt, current.timezone)}.
                </div>
                <Button size="sm" variant="secondary" loading={saving} onClick={() => save(current)}>Cancel</Button>
              </div>
            )}
            {error && <div className="notice error" role="alert" style={{ margin: 0 }}>{error}</div>}
            <Field label="Timezone" htmlFor="settings-timezone" hint={pending ? `Until then: ${timeZoneLabel(current.timezone)}` : undefined}>
              <ComboBox id="settings-timezone" options={options.data?.timezones ?? []} value={timezone} onChange={setTimezone} format={timeZoneLabel} />
            </Field>
            <Field
              label="Currency"
              htmlFor="settings-currency"
              hint={currencyChanging
                ? `Amounts aren't converted. After the switch, entries in ${current.currency} stay in your ledger but are left out of forecasts.`
                : undefined}
            >
              <ComboBox id="settings-currency" options={options.data?.currencies ?? []} value={currency} onChange={setCurrency} format={currencyLabel} />
            </Field>
            <div>
              <Button variant="primary" disabled={!dirty} loading={saving} onClick={() => save({ timezone, currency })}>
                Save for midnight
              </Button>
            </div>
          </div>
        </div>

        <div className="setting">
          <div>
            <h2 className="heading" style={{ fontSize: 17 }}>Monthly budget</h2>
            <p className="desc">What you'd like to spend in a month. Forecasts are measured against it.</p>
          </div>
          <div className="control">
            <div className="row" style={{ gap: 16 }}>
              <span className="amount" style={{ fontSize: 22 }}>
                {budget.data?.matchesCurrentCurrency ? formatMoney(budget.data.amount, budget.data.currency, "whole") : "Not set"}
              </span>
              <Button size="sm" onClick={() => setEditingBudget(true)}>{budget.data?.matchesCurrentCurrency ? "Change" : "Set a budget"}</Button>
            </div>
            {budget.data && !budget.data.matchesCurrentCurrency && (
              <p className="hint">Your previous budget was in {budget.data.currency} ({formatMoney(budget.data.amount, budget.data.currency, "whole")}). Set it again in {current.currency}.</p>
            )}
          </div>
        </div>

        <div className="setting">
          <div>
            <h2 className="heading" style={{ fontSize: 17 }}>Appearance</h2>
            <p className="desc">Light, dark, or whatever your device is set to.</p>
          </div>
          <div className="control">
            <Segmented<ThemeChoice>
              label="Theme"
              value={theme}
              onChange={setTheme}
              options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]}
            />
          </div>
        </div>

        <div className="setting">
          <div>
            <h2 className="heading" style={{ fontSize: 17 }}>Session</h2>
            <p className="desc">Sign out of Spendcast on this device.</p>
          </div>
          <div className="control">
            <div><Button onClick={logout}>Sign out</Button></div>
          </div>
        </div>
      </div>

      <BudgetModal
        open={editingBudget}
        onClose={() => setEditingBudget(false)}
        current={budget.data?.matchesCurrentCurrency ? budget.data.amount : null}
      />
    </>
  );
}
