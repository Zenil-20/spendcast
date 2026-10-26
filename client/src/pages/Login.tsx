import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../lib/auth";
import { Button, Field } from "../components/ui";
import { AuthLayout } from "./AuthLayout";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await login(email.trim(), password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== "/login" ? from : "/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to see how your month is shaping up."
      footer={<>New here? <Link to="/signup">Create an account</Link> — it takes a minute.</>}
    >
      <form onSubmit={submit} noValidate>
        {error && <div className="notice error" role="alert" style={{ margin: 0 }}>{error}</div>}
        <Field label="Email" htmlFor="email">
          <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} autoFocus />
        </Field>
        <Field label="Password" htmlFor="password">
          <div className="affix">
            <input id="password" className="input" style={{ paddingLeft: 11, paddingRight: 40 }} type={reveal ? "text" : "password"} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              style={{ position: "absolute", right: 5, top: 5 }}
              aria-label={reveal ? "Hide password" : "Show password"}
              onClick={() => setReveal(value => !value)}
            >
              {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </Field>
        <Button variant="primary" type="submit" block loading={submitting} style={{ marginTop: 6 }}>Sign in</Button>
      </form>
    </AuthLayout>
  );
}
