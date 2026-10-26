import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Link2, Search, Trash2 } from "lucide-react";
import { useSettings } from "../lib/auth";
import { useDeleteExpense, useExpenses } from "../lib/queries";
import { formatDate, formatMoney, monthName, monthRange, relativeDay, todayIn } from "../lib/format";
import { useShortcut } from "../lib/shortcuts";
import { useToast } from "../lib/toast";
import type { Expense } from "../lib/types";
import { Button, Category, EmptyState, Skeleton } from "../components/ui";

const UNDO_MS = 6000;

export function Expenses() {
  const { timezone, currency } = useSettings();
  const today = todayIn(timezone);
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { from, to } = monthRange(cursor.year, cursor.month);
  const expenses = useExpenses(from, to);
  const isCurrentMonth = today.slice(0, 7) === from.slice(0, 7);
  const { hidden, remove } = useUndoableDelete();

  useShortcut("/", () => searchRef.current?.focus());
  useEffect(() => setCategory(null), [from]);

  const shift = (delta: number) => setCursor(current => {
    const index = current.year * 12 + current.month - 1 + delta;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
  });

  const visible = useMemo(() => (expenses.data ?? []).filter(item => !hidden.has(item.id)), [expenses.data, hidden]);

  // Totals only add up amounts in the current currency.
  const byCategory = useMemo(() => {
    const totals = new Map<string, { amount: number; count: number }>();
    visible.filter(item => item.currency === currency).forEach(item => {
      const entry = totals.get(item.category) ?? { amount: 0, count: 0 };
      totals.set(item.category, { amount: entry.amount + item.amount, count: entry.count + 1 });
    });
    return [...totals.entries()].sort((a, b) => b[1].amount - a[1].amount);
  }, [visible, currency]);

  const monthTotal = byCategory.reduce((sum, [, entry]) => sum + entry.amount, 0);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return visible.filter(item =>
      (!category || item.category === category) &&
      (!term || `${item.title} ${item.category} ${item.paymentMethod} ${item.notes}`.toLowerCase().includes(term))
    );
  }, [visible, search, category]);

  const filteredTotal = filtered.filter(item => item.currency === currency).reduce((sum, item) => sum + item.amount, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Ledger</div>
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <Button variant="ghost" size="sm" iconOnly aria-label="Previous month" onClick={() => shift(-1)} icon={<ChevronLeft size={18} />} />
            <h1 className="title" style={{ minWidth: "7.5em", textAlign: "center" }}>{monthName(cursor.year, cursor.month)}</h1>
            <Button variant="ghost" size="sm" iconOnly aria-label="Next month" onClick={() => shift(1)} disabled={isCurrentMonth} icon={<ChevronRight size={18} />} />
          </div>
          {expenses.data && visible.length > 0 && (
            <p className="lede" style={{ marginTop: 8 }}>
              {formatMoney(monthTotal, currency, "whole")} across {visible.length} {visible.length === 1 ? "entry" : "entries"}.
              {byCategory[0] && <> {byCategory[0][0]} took the most — {formatMoney(byCategory[0][1].amount, currency, "whole")}.</>}
            </p>
          )}
        </div>
        <div className="affix" style={{ width: 280, maxWidth: "100%" }}>
          <span className="affix-start" style={{ display: "grid" }}><Search size={14} /></span>
          <input
            ref={searchRef}
            className="input"
            placeholder="Search this month"
            value={search}
            onChange={event => setSearch(event.target.value)}
            onKeyDown={event => { if (event.key === "Escape") { setSearch(""); event.currentTarget.blur(); } }}
            aria-label="Search this month"
          />
          {!search && <span className="affix-end hide-sm"><kbd>/</kbd></span>}
        </div>
      </div>

      <div className="columns">
        <section>
          {byCategory.length > 1 && (
            <div className="chips" style={{ marginBottom: 18 }}>
              <button className="chip" aria-pressed={category === null} onClick={() => setCategory(null)}>All</button>
              {byCategory.slice(0, 6).map(([name, entry]) => (
                <button key={name} className="chip" aria-pressed={category === name} onClick={() => setCategory(category === name ? null : name)}>
                  {name} <span className="count">{entry.count}</span>
                </button>
              ))}
            </div>
          )}

          {expenses.isPending && (
            <div style={{ display: "grid", gap: 14 }}>
              {[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} height={20} width={`${90 - i * 6}%`} />)}
            </div>
          )}

          {expenses.isError && <div className="notice error" role="alert">{expenses.error.message}</div>}

          {expenses.data && filtered.length === 0 && (
            <EmptyState
              title={search || category ? "Nothing matches that." : isCurrentMonth ? "A clean page." : "Nothing recorded this month."}
              text={search || category ? "Try another word, or clear the filter." : "Expenses you add will appear here, newest first. Press N to add one."}
              actions={(search || category) && <Button onClick={() => { setSearch(""); setCategory(null); }}>Clear filters</Button>}
            />
          )}

          {filtered.length > 0 && (
            <div className="table-scroll">
              <LedgerTable expenses={filtered} today={today} onDelete={remove} />
              {(search || category) && (
                <p className="small ink-2" style={{ marginTop: 12, textAlign: "right" }}>
                  {filtered.length} shown · <span className="amount">{formatMoney(filteredTotal, currency)}</span>
                </p>
              )}
            </div>
          )}
        </section>

        <aside>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Where it went</div>
          {byCategory.length === 0 ? (
            <p className="ink-3 small">Nothing to break down yet.</p>
          ) : (
            <div className="breakdown">
              {byCategory.map(([name, entry]) => (
                <div className="breakdown-row" key={name}>
                  <Category name={name} />
                  <span className="amount small">{formatMoney(entry.amount, currency, "whole")}</span>
                  <div className="bar"><span style={{ width: `${(entry.amount / byCategory[0][1].amount) * 100}%` }} /></div>
                </div>
              ))}
              <div className="row between" style={{ borderTop: "1px solid var(--ink)", paddingTop: 10, fontWeight: 600, fontSize: 13 }}>
                <span>Total</span>
                <span className="amount">{formatMoney(monthTotal, currency)}</span>
              </div>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function LedgerTable({ expenses, today, onDelete }: { expenses: Expense[]; today: string; onDelete: (expense: Expense) => void }) {
  return (
    <table className="ledger">
      <thead>
        <tr>
          <th>Date</th>
          <th>Description</th>
          <th className="hide-sm">Category</th>
          <th className="hide-sm">Paid with</th>
          <th className="num">Amount</th>
          <th style={{ width: 36 }}><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {expenses.map((item, index) => {
          const firstOfDay = index === 0 || expenses[index - 1].localDate !== item.localDate;
          const relative = relativeDay(item.localDate, today);

          return (
            <tr key={item.id} style={firstOfDay && index > 0 ? { borderTop: "1px solid var(--rule-strong)" } : undefined}>
              <td className="day-cell">
                {firstOfDay && (
                  <>
                    <div className="d">{formatDate(item.localDate, { day: "2-digit", month: "short" })}</div>
                    {relative && <div className="small ink-3">{relative}</div>}
                  </>
                )}
              </td>
              <td>
                <div style={{ fontWeight: 500 }}>
                  {item.title}
                  {item.recurringExpenseId && <Link2 size={12} className="ink-3" style={{ marginLeft: 6, verticalAlign: -1 }} aria-label="Linked to a recurring payment" />}
                </div>
                {item.notes && <div className="small ink-3">{item.notes}</div>}
              </td>
              <td className="hide-sm"><Category name={item.category} /></td>
              <td className="hide-sm ink-2">{item.paymentMethod}</td>
              <td className="num">{formatMoney(item.amount, item.currency)}</td>
              <td className="row-actions" style={{ textAlign: "right" }}>
                <Button variant="ghost" size="sm" iconOnly aria-label={`Delete ${item.title}`} title="Delete" onClick={() => onDelete(item)} icon={<Trash2 size={14} />} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Hides an expense at once and deletes it when its "Deleted" toast closes
// without Undo. The toast's timer pauses while hovered, so Undo works for as
// long as it's on screen. Leaving the page commits pending deletes and closes
// their toasts, so no Undo is left on screen that can't work.
function useUndoableDelete() {
  const toast = useToast();
  const deleteExpense = useDeleteExpense();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // Expense id -> its toast id, for deletes that can still be undone.
  const pending = useRef(new Map<string, string>());
  const mounted = useRef(true);
  const mutate = useRef(deleteExpense.mutate);
  const toastRef = useRef(toast);
  mutate.current = deleteExpense.mutate;
  toastRef.current = toast;

  function unhide(id: string) {
    if (!mounted.current) return;
    setHidden(current => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  // Sends the delete once; does nothing if it was undone or already sent.
  function commit(expense: Expense) {
    if (!pending.current.delete(expense.id)) return;

    mutate.current(expense.id, {
      onError: error => {
        unhide(expense.id);
        toastRef.current.error(`Couldn't delete "${expense.title}". ${error.message}`);
      }
    });
  }

  useEffect(() => {
    mounted.current = true;
    const waiting = pending.current;

    return () => {
      mounted.current = false;
      // Closing each toast runs its onDismiss, which commits the delete.
      [...waiting.values()].forEach(toastId => toastRef.current.dismiss(toastId));
    };
  }, []);

  function remove(expense: Expense) {
    setHidden(current => new Set(current).add(expense.id));

    const toastId = toast(`Deleted "${expense.title}"`, {
      kind: "info",
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          pending.current.delete(expense.id);
          unhide(expense.id);
        }
      },
      onDismiss: () => commit(expense)
    });

    pending.current.set(expense.id, toastId);
  }

  return { hidden, remove };
}
