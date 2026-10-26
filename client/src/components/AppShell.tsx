import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, Clock3, LayoutGrid, LineChart, LogOut, Plus, Repeat2, SlidersHorizontal } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useTheme, type ThemeChoice } from "../lib/theme";
import { api } from "../lib/api";
import { formatInstant, initials, zoneAbbreviation } from "../lib/format";
import { useShortcut } from "../lib/shortcuts";
import { ToastSlot } from "../lib/toast";
import { Button, Wordmark } from "./ui";
import { AddExpenseModal } from "./AddExpenseModal";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutGrid, end: true },
  { to: "/ledger", label: "Ledger", icon: BookOpen },
  { to: "/recurring", label: "Recurring", icon: Repeat2 },
  { to: "/investments", label: "Investments", icon: LineChart },
  { to: "/settings", label: "Settings", icon: SlidersHorizontal }
];

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "Match system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" }
];

export function AppShell() {
  const { user, setUser } = useAuth();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  // Expenses aren't part of the investments section, so it doesn't offer one.
  const canAddExpense = !useLocation().pathname.startsWith("/investments");

  useShortcut("n", () => setAdding(true), canAddExpense);

  // Keep settings fresh: a pending timezone/currency change takes effect at
  // midnight, and every amount and date on screen has to follow it.
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, refetchInterval: 60_000 });
  const settingsKey = user ? `${user.settings.timezone}|${user.settings.currency}` : "";
  const previousKey = useRef(settingsKey);

  useEffect(() => {
    if (me.data) {
      setUser(me.data.user);
    }
  }, [me.data, setUser]);

  useEffect(() => {
    if (previousKey.current && previousKey.current !== settingsKey) {
      queryClient.invalidateQueries({ predicate: query => query.queryKey[0] !== "me" });
    }

    previousKey.current = settingsKey;
  }, [settingsKey, queryClient]);

  if (!user) {
    return null;
  }

  const pending = user.pendingChange;

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/" className="wordmark" aria-label="Spendcast home"><Wordmark /></Link>

          <nav className="tabs" aria-label="Main">
            {NAV.map(item => (
              <NavLink key={item.to} to={item.to} end={item.end} className="tab">{item.label}</NavLink>
            ))}
          </nav>

          <ToastSlot />

          <div className="header-end">
            <span className="region" title={`${user.settings.timezone} · ${user.settings.currency}`}>
              {zoneAbbreviation(user.settings.timezone)} · {user.settings.currency}
            </span>
            {canAddExpense && (
              <Button variant="primary" icon={<Plus size={15} strokeWidth={2.25} />} shortcut="N" onClick={() => setAdding(true)}>
                <span className="hide-sm">New expense</span>
              </Button>
            )}
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="page">
        {pending && (
          <div className="notice" role="status">
            <Clock3 size={16} />
            <div>
              Switching to <strong>{pending.timezone.replace(/_/g, " ")}</strong> and <strong>{pending.currency}</strong> on{" "}
              {formatInstant(pending.effectiveAt, user.settings.timezone)}.{" "}
              <Link to="/settings">Change or cancel</Link>
            </div>
          </div>
        )}
        <Outlet />
      </main>

      <nav className="bottom-nav" aria-label="Main">
        {NAV.map(item => (
          <NavLink key={item.to} to={item.to} end={item.end}>
            <item.icon size={19} strokeWidth={1.75} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <AddExpenseModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function AccountMenu() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) {
    return null;
  }

  return (
    <div style={{ position: "relative" }} ref={rootRef}>
      <button className="avatar-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Account" onClick={() => setOpen(value => !value)}>
        {initials(user.name)}
      </button>
      {open && (
        <div className="popover" role="menu">
          <div className="who">
            <div style={{ fontWeight: 600 }}>{user.name}</div>
            <div className="small ink-3">{user.email}</div>
          </div>
          <div className="eyebrow" style={{ padding: "4px 10px" }}>Appearance</div>
          {THEMES.map(option => (
            <button key={option.value} className="menu-item" role="menuitemradio" aria-checked={theme === option.value} onClick={() => setTheme(option.value)}>
              {option.label}
              {theme === option.value && <Check size={14} className="check" />}
            </button>
          ))}
          <div className="sep" />
          <button className="menu-item" role="menuitem" onClick={logout}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
