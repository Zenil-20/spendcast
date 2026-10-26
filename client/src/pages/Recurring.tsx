import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useSettings } from "../lib/auth";
import { useBudget, useRecurring, useUpdateRecurring } from "../lib/queries";
import { addDays, formatDate, formatMoney, ordinal, todayIn } from "../lib/format";
import { useToast } from "../lib/toast";
import type { Frequency, RecurringExpense } from "../lib/types";
import { Button, Category, DateTile, EmptyState, Skeleton, Switch } from "../components/ui";
import { AddRecurringModal } from "../components/AddRecurringModal";

const PER_MONTH: Record<Frequency, number> = { monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
const INTERVAL: Record<Frequency, number> = { monthly: 1, quarterly: 3, yearly: 12 };
const UPCOMING_DAYS = 60;

// Due dates of a rule between two calendar dates, following the server's
// rules (a payment on the 31st falls on the last day of shorter months).
function dueDatesBetween(rule: RecurringExpense, from: string, to: string): string[] {
  const [startYear, startMonth, startDay] = rule.startDate.split("-").map(Number);
  const dates: string[] = [];

  for (let index = startYear * 12 + startMonth - 1, i = 0; i < 600; index += INTERVAL[rule.frequency], i++) {
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const due = `${year}-${String(month).padStart(2, "0")}-${String(Math.min(startDay, lastDay)).padStart(2, "0")}`;

    if (due > to || (rule.endDate && due > rule.endDate)) break;
    if (due >= from) dates.push(due);
  }

  return dates;
}

function schedule(rule: RecurringExpense): string {
  const day = Number(rule.startDate.slice(8, 10));
  if (rule.frequency === "monthly") return `Monthly on the ${ordinal(day)}`;
  if (rule.frequency === "quarterly") return `Every 3 months on the ${ordinal(day)}`;
  return `Yearly on ${formatDate(rule.startDate, { day: "numeric", month: "short" })}`;
}

export function Recurring() {
  const { timezone, currency } = useSettings();
  const today = todayIn(timezone);
  const recurring = useRecurring();
  const budget = useBudget();
  const [adding, setAdding] = useState(false);
  const rules = recurring.data ?? [];
  const current = rules.filter(rule => rule.isActive && !(rule.endDate && rule.endDate < today));
  const past = rules.filter(rule => !current.includes(rule));
  const monthly = current.filter(rule => rule.currency === currency).reduce((sum, rule) => sum + rule.amount * PER_MONTH[rule.frequency], 0);
  const budgetAmount = budget.data?.matchesCurrentCurrency ? budget.data.amount : null;

  const upcoming = useMemo(() => {
    const until = addDays(today, UPCOMING_DAYS);
    return current
      .flatMap(rule => dueDatesBetween(rule, today, until).map(date => ({ rule, date })))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [current, today]);

  const upcomingByMonth = useMemo(() => {
    const groups = new Map<string, typeof upcoming>();
    upcoming.forEach(item => groups.set(item.date.slice(0, 7), [...(groups.get(item.date.slice(0, 7)) ?? []), item]));
    return [...groups.entries()];
  }, [upcoming]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Recurring</div>
          <h1 className="title" style={{ marginTop: 6 }}>Bills that come back</h1>
          {current.length > 0 && (
            <p className="lede">
              <span className="amount" style={{ color: "var(--ink)" }}>{formatMoney(monthly, currency, "whole")}</span> a month is already spoken for
              {budgetAmount ? <> — about {Math.round((monthly / budgetAmount) * 100)}% of your budget.</> : "."}
              {" "}Yearly and quarterly bills are spread across the months.
            </p>
          )}
        </div>
        <Button variant="secondary" icon={<Plus size={15} />} onClick={() => setAdding(true)}>New recurring payment</Button>
      </div>

      {recurring.isPending && <div style={{ display: "grid", gap: 14 }}>{[0, 1, 2, 3].map(i => <Skeleton key={i} height={22} />)}</div>}
      {recurring.isError && <div className="notice error" role="alert">{recurring.error.message}</div>}

      {recurring.data && rules.length === 0 && (
        <EmptyState
          title="No recurring payments yet."
          text="Add your rent, subscriptions and yearly bills. They'll be placed on their exact due dates in every forecast."
          actions={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setAdding(true)}>Add the first one</Button>}
        />
      )}

      {rules.length > 0 && (
        <div className="columns">
          <section>
            <div className="section-head">
              <div>
                <div className="eyebrow">All payments</div>
                <h2 className="heading">{current.length} active</h2>
              </div>
            </div>
            <div className="table-scroll">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Payment</th>
                    <th className="hide-sm">Schedule</th>
                    <th className="num">Amount</th>
                    <th style={{ width: 60 }}><span className="sr-only">Active</span></th>
                  </tr>
                </thead>
                <tbody>
                  {current.map(rule => <RuleRow key={rule.id} rule={rule} />)}
                  {past.map(rule => <RuleRow key={rule.id} rule={rule} today={today} />)}
                </tbody>
              </table>
            </div>
          </section>

          <aside>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Next {UPCOMING_DAYS} days</div>
            {upcoming.length === 0 ? (
              <p className="ink-3 small">Nothing due in the next two months.</p>
            ) : (
              <div className="timeline">
                {upcomingByMonth.map(([month, items]) => (
                  <div key={month}>
                    <div className="month heading" style={{ fontSize: 16 }}>
                      {formatDate(`${month}-01`, { month: "long", year: "numeric" })}
                    </div>
                    {items.map(({ rule, date }) => (
                      <div className="item" key={rule.id + date}>
                        <DateTile date={date} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 550 }}>{rule.title}</div>
                          <div className="small ink-3">{date === today ? "Due today" : rule.category}</div>
                        </div>
                        <span className="amount small">{formatMoney(rule.amount, rule.currency, "whole")}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}

      <AddRecurringModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function RuleRow({ rule, today }: { rule: RecurringExpense; today?: string }) {
  const update = useUpdateRecurring();
  const toast = useToast();
  const ended = !!(today && rule.endDate && rule.endDate < today);

  async function toggle(isActive: boolean) {
    try {
      await update.mutateAsync({ id: rule.id, changes: { isActive } });
      toast(isActive ? `${rule.title} is back in your forecast` : `${rule.title} paused — it won't be forecast`);
    } catch (error) {
      toast((error as Error).message, "error");
    }
  }

  return (
    <tr className={rule.isActive && !ended ? undefined : "muted-row"}>
      <td>
        <div style={{ fontWeight: 550, color: "var(--ink)" }}>{rule.title}</div>
        <div className="small" style={{ marginTop: 2 }}><Category name={rule.category} /></div>
      </td>
      <td className="hide-sm">
        {schedule(rule)}
        {ended && <div className="small">Ended {formatDate(rule.endDate!)}</div>}
        {!ended && !rule.isActive && <div className="small">Paused</div>}
      </td>
      <td className="num">{formatMoney(rule.amount, rule.currency)}</td>
      <td style={{ textAlign: "right" }}>
        {!ended && (
          <Switch
            checked={rule.isActive}
            disabled={update.isPending}
            label={rule.isActive ? `Pause ${rule.title}` : `Resume ${rule.title}`}
            onChange={toggle}
          />
        )}
      </td>
    </tr>
  );
}
