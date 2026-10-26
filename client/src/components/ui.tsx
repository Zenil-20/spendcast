import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode
} from "react";
import { AlertTriangle, Check, Minus, X } from "lucide-react";
import type { BudgetStatus } from "../lib/types";
import { currencySymbol } from "../lib/format";

/* ---------- Button ---------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "link";
  size?: "md" | "sm";
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
  iconOnly?: boolean;
  shortcut?: string;
};

export function Button({ variant = "secondary", size = "md", loading, icon, block, iconOnly, shortcut, className = "", children, disabled, ...rest }: ButtonProps) {
  const classes = [
    "btn",
    `btn-${variant}`,
    size === "sm" && "btn-sm",
    block && "btn-block",
    iconOnly && "btn-icon",
    className
  ].filter(Boolean).join(" ");

  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon}
      {children}
      {shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}
    </button>
  );
}

/* ---------- Fields ---------- */

export function Field({ label, hint, error, htmlFor, children }: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <div className="error-text" role="alert">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function MoneyInput({ id, currency, value, onChange, invalid, autoFocus }: {
  id?: string;
  currency: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="affix money">
      <span className="affix-start">{currencySymbol(currency)}</span>
      <input
        id={id}
        className="input"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        value={value}
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        onChange={event => {
          // Digits and one decimal point only.
          const cleaned = event.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
          onChange(cleaned);
        }}
      />
    </div>
  );
}

/* ---------- Segmented control ---------- */

export function Segmented<T extends string | number>({ label, options, value, onChange }: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(option => (
        <button key={String(option.value)} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Switch ---------- */

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

/* ---------- Searchable select ---------- */

export function ComboBox({ id, options, value, onChange, placeholder, invalid, format = defaultFormat }: {
  id?: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  format?: (option: string) => string;
}) {
  const listId = useId();
  const [query, setQuery] = useState(format(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => setQuery(format(value)), [value, format]);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();

    if (!term || term === format(value).toLowerCase()) {
      return options.slice(0, 300);
    }

    return options
      .filter(option => option.toLowerCase().includes(term.replace(/\s+/g, "_")) || format(option).toLowerCase().includes(term))
      .slice(0, 300);
  }, [options, query, value, format]);

  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery(format(value));
      }
    }

    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [value, format]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(option: string) {
    onChange(option);
    setQuery(format(option));
    setOpen(false);
  }

  return (
    <div className="combo" ref={rootRef}>
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onFocus={event => { setOpen(true); event.target.select(); }}
        onChange={event => { setQuery(event.target.value); setOpen(true); setActive(0); }}
        onKeyDown={event => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive(index => Math.min(index + 1, matches.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive(index => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && open && matches[active]) {
            event.preventDefault();
            choose(matches[active]);
          } else if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
            setQuery(format(value));
          }
        }}
      />
      {open && matches.length > 0 && (
        <ul className="combo-list" id={listId} role="listbox" ref={listRef}>
          {matches.map((option, index) => (
            <li
              key={option}
              data-index={index}
              role="option"
              aria-selected={index === active}
              onMouseDown={event => { event.preventDefault(); choose(option); }}
              onMouseEnter={() => setActive(index)}
            >
              {format(option)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function defaultFormat(option: string) {
  return option.replace(/_/g, " ");
}

/* ---------- Dialog ---------- */

export function Dialog({ open, title, description, onClose, children, footer }: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("[data-autofocus], input, select, textarea")?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }

      // Keep keyboard focus inside the dialog.
      if (event.key === "Tab" && ref.current) {
        const focusable = [...ref.current.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")]
          .filter(element => !element.hasAttribute("disabled"));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }

    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="dialog-head">
          <div>
            <h2 className="heading" id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={onClose} icon={<X size={15} />} />
        </div>
        {children}
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Status ---------- */

const STATUS: Record<BudgetStatus, { label: string; glyph: ReactNode }> = {
  within_budget: { label: "Within budget", glyph: <Check size={10} strokeWidth={3.5} /> },
  at_risk: { label: "At risk", glyph: <AlertTriangle size={9} strokeWidth={3} /> },
  over_budget: { label: "Over budget", glyph: <X size={10} strokeWidth={3.5} /> },
  budget_not_set: { label: "No budget", glyph: <Minus size={10} strokeWidth={3.5} /> }
};

export function StatusBadge({ status, label }: { status: BudgetStatus; label?: string }) {
  return (
    <span className={`status ${status}`}>
      <span className="glyph" aria-hidden="true">{STATUS[status].glyph}</span>
      {label ?? STATUS[status].label}
    </span>
  );
}

/* ---------- Bits ---------- */

export function Skeleton({ height = 14, width = "100%", style }: { height?: number; width?: number | string; style?: CSSProperties }) {
  return <div className="skeleton" style={{ height, width, ...style }} aria-hidden="true" />;
}

export function EmptyState({ title, text, actions }: { title: string; text: string; actions?: ReactNode }) {
  return (
    <div className="empty">
      <h3 className="heading">{title}</h3>
      <p>{text}</p>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function DateTile({ date }: { date: string }) {
  const [year, month, day] = date.split("-").map(Number);
  const monthShort = new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));

  return (
    <div className="date-tile" aria-hidden="true">
      <div className="m">{monthShort}</div>
      <div className="d">{day}</div>
    </div>
  );
}

// Muted, earthy dot colors for categories. Known categories get a fixed
// color; anything else gets a stable color from its name.
const CATEGORY_COLORS: Record<string, string> = {
  food: "#7a8f3a", dining: "#c0793b", housing: "#5b6f8f", transport: "#6c8a86",
  utilities: "#8f7b4f", shopping: "#a8607a", entertainment: "#7a6aa8", health: "#4f9b7d",
  travel: "#3f86a8", insurance: "#7d7468", festivals: "#c25a4a", electronics: "#5d6470",
  education: "#9a7a3c"
};
const FALLBACK_COLORS = ["#7a8f3a", "#c0793b", "#5b6f8f", "#a8607a", "#4f9b7d", "#8f7b4f", "#7a6aa8", "#3f86a8"];

export function categoryColor(category: string): string {
  const key = category.trim().toLowerCase();

  if (CATEGORY_COLORS[key]) {
    return CATEGORY_COLORS[key];
  }

  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

export function Category({ name }: { name: string }) {
  return <span className="cat" style={{ ["--cat" as string]: categoryColor(name) }}>{name}</span>;
}

export function Wordmark() {
  return (
    <>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <rect x="0.5" y="0.5" width="21" height="21" rx="5" fill="var(--ink)" />
        <path d="M6 15.5V11M11 15.5V7M16 15.5V9.5" stroke="var(--paper)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span>Spendcast</span>
    </>
  );
}
