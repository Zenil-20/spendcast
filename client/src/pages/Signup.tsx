import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useOptions } from "../lib/queries";
import { browserCurrency, browserTimeZone } from "../lib/format";
import { Button, ComboBox, Field } from "../components/ui";
import { AuthLayout } from "./AuthLayout";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Signup() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const options = useOptions();
  const [form, setForm] = useState({ name: "", email: "", password: "", timezone: browserTimeZone(), currency: browserCurrency() });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (field: keyof typeof form) => (value: string) => setForm(current => ({ ...current, [field]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const timezones = options.data?.timezones ?? [];
    const currencies = options.data?.currencies ?? [];
    const nextErrors = {
      name: form.name.trim() ? undefined : "What should we call you?",
      email: EMAIL_PATTERN.test(form.email.trim()) ? undefined : "That doesn't look like an email address.",
      password: form.password.length >= 8 ? undefined : "Use at least 8 characters.",
      timezone: !timezones.length || timezones.includes(form.timezone) ? undefined : "Pick a timezone from the list.",
      currency: !currencies.length || currencies.includes(form.currency) ? undefined : "Pick a currency from the list."
    };
    setErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    setServerError(null);
    setSubmitting(true);

    try {
      await register({ ...form, name: form.name.trim(), email: form.email.trim() });
      navigate("/", { replace: true });
    } catch (err) {
      setServerError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Start your ledger"
      subtitle="We've guessed your timezone and currency from this browser. Change them if they're wrong."
      footer={<>Already have an account? <Link to="/login">Sign in</Link></>}
    >
      <form onSubmit={submit} noValidate>
        {serverError && <div className="notice error" role="alert" style={{ margin: 0 }}>{serverError}</div>}
        <Field label="Name" htmlFor="name" error={errors.name}>
          <input id="name" className="input" autoComplete="name" value={form.name} onChange={event => set("name")(event.target.value)} aria-invalid={!!errors.name || undefined} autoFocus maxLength={100} />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email}>
          <input id="email" className="input" type="email" autoComplete="email" value={form.email} onChange={event => set("email")(event.target.value)} aria-invalid={!!errors.email || undefined} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password} hint="At least 8 characters.">
          <input id="password" className="input" type="password" autoComplete="new-password" value={form.password} onChange={event => set("password")(event.target.value)} aria-invalid={!!errors.password || undefined} maxLength={128} />
        </Field>
        <div className="grid-2">
          <Field label="Timezone" htmlFor="timezone" error={errors.timezone}>
            <ComboBox id="timezone" options={options.data?.timezones ?? []} value={form.timezone} onChange={set("timezone")} invalid={!!errors.timezone} />
          </Field>
          <Field label="Currency" htmlFor="currency" error={errors.currency}>
            <ComboBox id="currency" options={options.data?.currencies ?? []} value={form.currency} onChange={set("currency")} invalid={!!errors.currency} />
          </Field>
        </div>
        <Button variant="primary" type="submit" block loading={submitting} style={{ marginTop: 6 }}>Create account</Button>
      </form>
    </AuthLayout>
  );
}
