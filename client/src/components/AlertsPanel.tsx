import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronDown, PieChart, Target, TrendingDown } from "lucide-react";
import { useAlerts, useUpdateAlert } from "../lib/queries";
import { useToast } from "../lib/toast";
import { formatDate } from "../lib/format";
import type { PortfolioAlert } from "../lib/types";
import { Button } from "./ui";

/*
 * Alerts that fired because a condition lasted, not because of one bad day.
 * Each one opens to show why it fired, the period and data behind it, and
 * what to look into. Dismissing keeps it quiet for 30 days.
 */

const ICONS = {
  underperformance: TrendingDown,
  concentration: PieChart,
  goal: Target,
  reconcile: AlertTriangle
};

const shortDate = (date: string) => formatDate(date.slice(0, 10), { day: "numeric", month: "short" });

export function AlertsPanel() {
  const alerts = useAlerts();
  if (!alerts.data?.length) return null;

  return (
    <section className="alerts" aria-label="Alerts">
      <div className="eyebrow">Worth a look · {alerts.data.length}</div>
      {alerts.data.map(alert => <AlertRow key={alert.id} alert={alert} />)}
    </section>
  );
}

function AlertRow({ alert }: { alert: PortfolioAlert }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateAlert();
  const toast = useToast();
  const Icon = ICONS[alert.type];
  const bodyId = `alert-${alert.id}`;

  async function dismiss() {
    try {
      await update.mutateAsync({ id: alert.id, status: "dismissed" });
      toast.success("Dismissed for 30 days");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <div className={`alert-row ${alert.severity}`}>
      <button type="button" className="alert-head" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(value => !value)}>
        <span className="ic"><Icon size={15} /></span>
        <span className="t">{alert.title}</span>
        <span className="small ink-3 since">since {shortDate(alert.firstSeenAt)}</span>
        <ChevronDown size={16} className="chev" />
      </button>

      {open && (
        <div className="alert-body" id={bodyId}>
          <p>{alert.why}</p>
          {alert.period?.from && (
            <div className="small ink-3">Period: {formatDate(alert.period.from)} – {formatDate(alert.period.to!)}</div>
          )}

          {alert.evidence && alert.evidence.rows.length > 0 && (
            <div className="table-scroll">
              <table className="ledger compact">
                <thead>
                  <tr>{alert.evidence.columns.map((column, i) => <th key={i} className={i ? "num" : ""}>{column}</th>)}</tr>
                </thead>
                <tbody>
                  {alert.evidence.rows.map((row, r) => (
                    <tr key={r}>{row.map((cell, i) => <td key={i} className={i ? "num" : ""}>{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {alert.investigate.length > 0 && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>What to look into</div>
              <ul className="alert-list">{alert.investigate.map(item => <li key={item}>{item}</li>)}</ul>
            </div>
          )}

          <div className="row" style={{ gap: 8 }}>
            {alert.link && <Link className="btn btn-secondary btn-sm" to={alert.link}>Open</Link>}
            <Button variant="ghost" size="sm" loading={update.isPending} onClick={dismiss}>Dismiss for 30 days</Button>
          </div>
        </div>
      )}
    </div>
  );
}
