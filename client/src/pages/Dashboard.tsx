import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useForecast } from "../lib/queries";
import { formatMoney, longDate, ordinal } from "../lib/format";
import type { Forecast, ForecastMonth } from "../lib/types";
import { ForecastChart } from "../components/ForecastChart";
import { BudgetModal } from "../components/BudgetModal";
import { AddRecurringModal } from "../components/AddRecurringModal";
import { Button, DateTile, Segmented, Skeleton, StatusBadge } from "../components/ui";

export function Dashboard() {
  const { user } = useAuth();
  const [months, setMonths] = useState(3);
  const [editingBudget, setEditingBudget] = useState(false);
  const [addingRecurring, setAddingRecurring] = useState(false);
  const forecast = useForecast(months);
  const data = forecast.data;
  const history = data?.monthlyHistory ?? [];
  const typicalSpend = history.length
    ? [...history.map(m => m.totalExpenditure)].sort((a, b) => a - b)[Math.floor(history.length / 2)]
    : undefined;

  return (
    <>
      <div className="eyebrow" style={{ marginBottom: 14 }}>Overview — {longDate(user!.settings.timezone)}</div>

      {forecast.isPending && <OverviewSkeleton />}

      {forecast.isError && (
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          <div>
            We couldn't load your forecast. {forecast.error.message}{" "}
            <button className="btn btn-link" onClick={() => forecast.refetch()}>Try again</button>
          </div>
        </div>
      )}

      {data && data.warnings.length > 0 && (
        <div className="notice warn">
          <AlertTriangle size={16} />
          <div>
            Some of your records aren't included in this forecast.
            <ul>{data.warnings.map(text => <li key={text}>{text}</li>)}</ul>
          </div>
        </div>
      )}

      {data && !data.forecast && (
        <>
          <h1 className="display" style={{ maxWidth: "20ch" }}>Your forecast begins with a few weeks of spending.</h1>
          <p className="lede" style={{ marginTop: 14 }}>
            Record what you spend and add the bills you pay every month. After a week or so, Spendcast can tell you how the month will end.
          </p>
          <div className="row wrap" style={{ marginTop: 24, gap: 10 }}>
            <Link to="/ledger" className="btn btn-primary" style={{ textDecoration: "none" }}>Open the ledger</Link>
            <Button onClick={() => setAddingRecurring(true)}>Add a recurring bill</Button>
          </div>
        </>
      )}

      {data?.forecast && data.currentMonth && (
        <Overview
          data={data}
          months={months}
          onMonthsChange={setMonths}
          onEditBudget={() => setEditingBudget(true)}
          fetching={forecast.isFetching}
        />
      )}

      <BudgetModal
        open={editingBudget}
        onClose={() => setEditingBudget(false)}
        current={data?.currentMonth?.budget ?? null}
        typicalSpend={typicalSpend}
      />
      <AddRecurringModal open={addingRecurring} onClose={() => setAddingRecurring(false)} />
    </>
  );
}

// Full month name ("October"); the API's labels are short ("Oct 2026").
function monthName({ year, month }: { year: number; month: number }) {
  return new Intl.DateTimeFormat(undefined, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function Overview({ data, months, onMonthsChange, onEditBudget, fetching }: {
  data: Forecast;
  months: number;
  onMonthsChange: (months: number) => void;
  onEditBudget: () => void;
  fetching: boolean;
}) {
  const currency = data.currency;
  const current = data.currentMonth!;
  const ahead = data.forecast!;
  const next = ahead[0];
  const budget = current.budget;
  const daysIn = Math.floor(current.daysElapsed) + 1;
  const usedShare = budget ? Math.min(100, (current.spentSoFar / budget) * 100) : 0;
  const overCount = ahead.filter(month => month.budgetStatus === "over_budget").length;
  const tone = current.budgetStatus === "over_budget" ? "over" : current.budgetStatus === "at_risk" ? "risk" : "ok";
  const billsDue = current.upcomingRecurringExpenditure;

  const projected = current.projectedTotalExpenditure;
  const scale = budget ? Math.max(budget, projected) : projected;
  const spentWidth = scale ? (current.spentSoFar / scale) * 100 : 0;
  const projectedWidth = scale ? Math.max(0, (projected - current.spentSoFar) / scale) * 100 : 0;
  const gap = budget !== null ? budget - projected : null;

  return (
    <div className="stack-lg">
      <section className="summary-card" aria-label={`${monthName(current)} summary`}>
        <div className="summary-top">
          <div>
            <div className="hero-label">{monthName(current)} spending so far</div>
            <div className="hero-value amount">{formatMoney(current.spentSoFar, currency, "whole")}</div>
            <div className="hero-sub">
              Heading for {formatMoney(projected, currency, "whole")} by month end
              {gap !== null && (
                <span className={`figure-mark ${tone}`} style={{ fontFamily: "var(--sans)", fontStyle: "normal", marginLeft: 8 }}>
                  {gap >= 0 ? `${formatMoney(gap, currency, "whole")} under budget` : `${formatMoney(-gap, currency, "whole")} over budget`}
                </span>
              )}
            </div>
          </div>
          <span className="market-chip">Day {daysIn} of {current.daysInMonth}</span>
        </div>

        {budget !== null && (
          <div className="budget-bar" role="meter" aria-label="Budget used so far" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usedShare)}>
            <div className="track">
              <span className={`spent ${tone}`} style={{ width: `${spentWidth}%` }} />
              <span className="projected" style={{ width: `${projectedWidth}%` }} />
              <i className="limit" style={{ left: `${(budget / scale) * 100}%` }} />
            </div>
            <div className="row between small ink-3" style={{ marginTop: 6 }}>
              <span>Spent {Math.round((current.spentSoFar / budget) * 100)}% · projected {Math.round((projected / budget) * 100)}%</span>
              <span>Budget {formatMoney(budget, currency, "whole")}</span>
            </div>
          </div>
        )}

        <div className="stat-row">
          <div>
            <div className="k row between">Monthly budget <button className="btn btn-link small" onClick={onEditBudget}>{budget === null ? "Set" : "Edit"}</button></div>
            <div className="v">{budget === null ? "—" : formatMoney(budget, currency, "whole")}</div>
            <div className="s ink-3">
              {budget === null ? "Set one for early warnings" : overCount === 0 ? `Next ${ahead.length} months fit` : `${overCount} of next ${ahead.length} months over`}
            </div>
          </div>
          <div>
            <div className="k">{monthName(next)} forecast</div>
            <div className="v">{formatMoney(next.estimatedTotalExpenditure, currency, "whole")}</div>
            <div className="s ink-3">Likely {formatMoney(next.estimatedTotalRange.low, currency, "compact")}–{formatMoney(next.estimatedTotalRange.high, currency, "compact")}</div>
          </div>
          <div>
            <div className="k">Still expected this month</div>
            <div className="v">{formatMoney(current.expectedRemainingVariableExpenditure + billsDue, currency, "whole")}</div>
            <div className="s ink-3">{billsDue > 0 ? `incl. ${formatMoney(billsDue, currency, "whole")} in bills` : "all bills paid"}</div>
          </div>
          <div>
            <div className="k">Forecast accuracy</div>
            <div className="v">{data.accuracy ? `${Math.max(0, Math.round(100 - data.accuracy.weightedAbsolutePercentageError))}%` : "—"}</div>
            <div className="s ink-3">{data.accuracy ? `tested on ${data.accuracy.evaluatedMonths} months` : "needs more history"}</div>
          </div>
        </div>

        <div className="row between wrap" style={{ margin: "18px 0 4px", gap: 12 }}>
          <h2 className="heading" style={{ fontSize: 17 }}>Month by month</h2>
          <div className="row" style={{ gap: 12 }}>
            {fetching && <span className="spinner ink-3" aria-label="Updating" />}
            <Segmented<number>
              label="Forecast length"
              value={months}
              onChange={onMonthsChange}
              options={[{ value: 3, label: "Next 3 mo" }, { value: 6, label: "6 mo" }, { value: 12, label: "12 mo" }]}
            />
          </div>
        </div>
        <ForecastChart data={data} />
      </section>

      <section className="columns">
        <div>
          <div className="section-head">
            <div>
              <div className="eyebrow">Ahead</div>
              <h2 className="heading">What the coming months look like</h2>
            </div>
          </div>
          <MonthsTable months={ahead} currency={currency} />
        </div>

        <aside>
          <div className="section-head">
            <div>
              <div className="eyebrow">{monthName(current)}</div>
              <h2 className="heading">Still to pay</h2>
            </div>
          </div>
          {current.upcomingRecurringPayments.length === 0 ? (
            <p className="ink-2" style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 16, padding: "8px 0 16px", borderBottom: "1px solid var(--rule)" }}>
              Every bill for {monthName(current)} is paid.
            </p>
          ) : (
            <div>
              {current.upcomingRecurringPayments.map(payment => (
                <div className="list-row" key={payment.recurringExpenseId}>
                  <DateTile date={payment.dueDate} />
                  <div className="grow">
                    <div className="t">{payment.title}</div>
                    <div className="s">{payment.category}</div>
                  </div>
                  <span className="amount">{formatMoney(payment.amount, currency, "whole")}</span>
                </div>
              ))}
            </div>
          )}

          <dl style={{ margin: "18px 0 0", display: "grid", gridTemplateColumns: "1fr auto", rowGap: 8, fontSize: 13 }}>
            <dt className="ink-2">Spent so far</dt>
            <dd className="amount" style={{ margin: 0, textAlign: "right" }}>{formatMoney(current.spentSoFar, currency, "whole")}</dd>
            <dt className="ink-2">Everyday, still expected</dt>
            <dd className="amount" style={{ margin: 0, textAlign: "right" }}>{formatMoney(current.expectedRemainingVariableExpenditure, currency, "whole")}</dd>
            <dt className="ink-2">Bills, still due</dt>
            <dd className="amount" style={{ margin: 0, textAlign: "right" }}>{formatMoney(billsDue, currency, "whole")}</dd>
            <dt style={{ borderTop: "1px solid var(--ink)", paddingTop: 8, fontWeight: 600 }}>Projected</dt>
            <dd className="amount" style={{ margin: 0, textAlign: "right", borderTop: "1px solid var(--ink)", paddingTop: 8, fontWeight: 600 }}>
              {formatMoney(current.projectedTotalExpenditure, currency, "whole")}
            </dd>
          </dl>
        </aside>
      </section>

      <p className="disclaimer" style={{ borderTop: "1px solid var(--rule)", paddingTop: 18 }}>
        Bills are placed on their due dates; everyday spending is estimated from your history, with one-off purchases set
        aside and yearly patterns included. "Likely" ranges hold about 8 times in 10.
      </p>
    </div>
  );
}

function MonthsTable({ months, currency }: { months: ForecastMonth[]; currency: string }) {
  return (
    <div className="table-scroll">
      <table className="ledger">
        <thead>
          <tr>
            <th>Month</th>
            <th className="num">Everyday</th>
            <th className="num">Bills</th>
            <th className="num">Total</th>
            <th className="num hide-sm">Likely range</th>
            <th>Budget</th>
          </tr>
        </thead>
        <tbody>
          {months.map(month => {
            const seasonal = Math.round((month.seasonalFactor - 1) * 100);
            const bills = month.recurringPayments
              .map(payment => `${payment.title} ${ordinal(Number(payment.dueDate.slice(8, 10)))}`)
              .join(" · ");

            return (
                <tr key={month.monthLabel}>
                  <td>
                    <div style={{ fontFamily: "var(--serif)", fontSize: 15.5 }}>{month.monthLabel}</div>
                    {bills && <div className="small ink-3" style={{ marginTop: 2 }}>{bills}</div>}
                  </td>
                  <td className="num">
                    {formatMoney(month.estimatedVariableExpenditure, currency, "whole")}
                    {seasonal !== 0 && (
                      <div className="small ink-3" title="Adjusted for a pattern that repeats in this month every year">
                        {seasonal > 0 ? "+" : "−"}{Math.abs(seasonal)}% seasonal
                      </div>
                    )}
                  </td>
                  <td className="num">{formatMoney(month.expectedRecurringExpenditure, currency, "whole")}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{formatMoney(month.estimatedTotalExpenditure, currency, "whole")}</td>
                  <td className="num ink-2 hide-sm">
                    {formatMoney(month.estimatedTotalRange.low, currency, "compact")}–{formatMoney(month.estimatedTotalRange.high, currency, "compact")}
                  </td>
                  <td>
                    <StatusBadge status={month.budgetStatus} />
                    {month.budgetDifference !== null && month.budgetStatus !== "budget_not_set" && (
                      <div className="small ink-3 amount" style={{ marginTop: 2 }}>
                        {month.budgetDifference >= 0
                          ? `${formatMoney(month.budgetDifference, currency, "whole")} spare`
                          : `${formatMoney(-month.budgetDifference, currency, "whole")} over`}
                      </div>
                    )}
                  </td>
                </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="stack-lg" aria-busy="true">
      <div>
        <Skeleton height={40} width="72%" />
        <Skeleton height={40} width="48%" style={{ marginTop: 10 }} />
        <Skeleton height={16} width="56%" style={{ marginTop: 18 }} />
      </div>
      <div className="figures">
        {[0, 1, 2, 3].map(i => (
          <div className="figure" key={i}>
            <Skeleton height={10} width="50%" />
            <Skeleton height={28} width="70%" style={{ margin: "12px 0 8px" }} />
            <Skeleton height={10} width="80%" />
          </div>
        ))}
      </div>
      <Skeleton height={340} />
    </div>
  );
}
