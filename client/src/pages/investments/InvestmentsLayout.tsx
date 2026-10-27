import { useState, type KeyboardEvent } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { AlertTriangle, ChevronDown, Plus, Search, X } from "lucide-react";
import { useAlerts, usePortfolio } from "../../lib/queries";
import { formatDate } from "../../lib/format";
import type { Portfolio, PortfolioAlert } from "../../lib/types";
import { AddInvestmentModal } from "../../components/AddInvestmentModal";
import { Button, Skeleton } from "../../components/ui";
import { ALL_SECTIONS, legacyTabUrl, matchesSearch, SECTION_GROUPS, sectionUrl, type Section } from "./sections";

/*
 * Investments: a grouped side menu (a drop-down on phones) and one page per
 * section. The menu is built from SECTION_GROUPS, so it grows with the list.
 */

const COLLAPSED_KEY = "spendcast.investments.collapsed";

interface LayoutContext {
  openAdd: () => void;
}

// The section a path belongs to; a single fund's page counts as Holdings.
function currentPath(pathname: string): string {
  const segment = pathname.replace(/^\/investments\/?/, "").split("/")[0];
  return /^\d+$/.test(segment) ? "holdings" : segment;
}

export function InvestmentsLayout() {
  const portfolio = usePortfolio();
  const [adding, setAdding] = useState(false);
  const [params] = useSearchParams();
  const { pathname } = useLocation();

  // Links from before sections had their own pages: /investments?tab=goals.
  const legacy = params.get("tab");
  const moved = legacy && currentPath(pathname) === "" ? legacyTabUrl(legacy) : null;
  if (moved) return <Navigate to={moved} replace />;

  return (
    <>
      <div className="row between wrap" style={{ marginBottom: 20, gap: 12 }}>
        <div className="row" style={{ gap: 12 }}>
          <h1 className="title" style={{ fontSize: 26 }}>Investments</h1>
          {portfolio.data?.asOf && <MarketChip data={portfolio.data} />}
        </div>
        <Button variant="secondary" icon={<Plus size={15} />} onClick={() => setAdding(true)}>Add a fund</Button>
      </div>

      <div className="invest-layout">
        <SectionNav data={portfolio.data} />
        <div className="invest-main">
          <Outlet context={{ openAdd: () => setAdding(true) } satisfies LayoutContext} />
        </div>
      </div>

      <AddInvestmentModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

// Only states what is certain: weekends are closed; weekday holidays can't be
// known in advance from NAV data, so no "open" claim is made.
function MarketChip({ data }: { data: Portfolio }) {
  return (
    <span className="market-chip">
      <span className="dot" />
      {data.calendar?.todayIsWeekend && "Weekend · "}NAVs as of {formatDate(data.asOf!, { weekday: "short", day: "numeric", month: "short" })}
    </span>
  );
}

/* ---------- Menu ---------- */

function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function writeCollapsed(groups: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...groups]));
  } catch {
    /* the menu still works for this visit */
  }
}

function alertCount(section: Section, alerts: PortfolioAlert[] | undefined) {
  if (!section.alertTypes || !alerts) return 0;
  return alerts.filter(alert => section.alertTypes!.includes(alert.type)).length;
}

function SectionNav({ data }: { data: Portfolio | undefined }) {
  const alerts = useAlerts().data;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const current = currentPath(pathname);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const matches = query.trim() ? ALL_SECTIONS.filter(section => matchesSearch(section, query)) : null;

  function toggle(groupId: string) {
    setCollapsed(previous => {
      const next = new Set(previous);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      writeCollapsed(next);
      return next;
    });
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && matches?.length) {
      navigate(sectionUrl(matches[0]));
      setQuery("");
    } else if (event.key === "Escape") {
      setQuery("");
    }
  }

  const item = (section: Section) => {
    const alertsHere = alertCount(section, alerts);
    const count = data && section.count ? section.count(data) : null;
    return (
      <li key={section.path}>
        <NavLink
          to={sectionUrl(section)}
          end={section.path === ""}
          className={({ isActive }) => `nav-item${isActive || section.path === current ? " active" : ""}`}
          onClick={() => setQuery("")}
        >
          <section.icon size={15} />
          <span className="label">{section.label}</span>
          {alertsHere > 0 && <span className="nav-alert" title={`${alertsHere} open alert${alertsHere === 1 ? "" : "s"}`}>{alertsHere}</span>}
          {count !== null && <span className="nav-count">{count}</span>}
        </NavLink>
      </li>
    );
  };

  return (
    <>
      <nav className="invest-nav" aria-label="Investment sections">
        <div className="nav-search">
          <Search size={14} className="ink-3" />
          <input
            aria-label="Find a section"
            placeholder="Find a section"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={onSearchKey}
          />
          {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={13} /></button>}
        </div>

        {matches && (
          matches.length
            ? <ul className="nav-list">{matches.map(item)}</ul>
            : <p className="small ink-3" style={{ padding: "6px 10px" }}>No section matches “{query.trim()}”.</p>
        )}

        {!matches && SECTION_GROUPS.map(group => {
          // The group holding the current page always stays open.
          const open = !collapsed.has(group.id) || group.sections.some(section => section.path === current);
          const groupAlerts = group.sections.reduce((sum, section) => sum + alertCount(section, alerts), 0);
          return (
            <div className="nav-group" key={group.id}>
              <button type="button" className="nav-group-head" aria-expanded={open} onClick={() => toggle(group.id)}>
                <span>{group.label}</span>
                {!open && groupAlerts > 0 && <span className="nav-alert">{groupAlerts}</span>}
                <ChevronDown size={13} className="chev" />
              </button>
              {open && <ul className="nav-list">{group.sections.map(item)}</ul>}
            </div>
          );
        })}
      </nav>

      <label className="invest-nav-mobile">
        <span className="sr-only">Section</span>
        <select className="select" value={current} onChange={event => navigate(event.target.value ? `/investments/${event.target.value}` : "/investments")}>
          {SECTION_GROUPS.map(group => (
            <optgroup key={group.id} label={group.label}>
              {group.sections.map(section => {
                const alertsHere = alertCount(section, alerts);
                return <option key={section.path} value={section.path}>{section.label}{alertsHere ? ` (${alertsHere} alert${alertsHere === 1 ? "" : "s"})` : ""}</option>;
              })}
            </optgroup>
          ))}
        </select>
      </label>
    </>
  );
}

/* ---------- Section frame ---------- */

// Header, loading, error and empty states shared by every section.
export function SectionPage({ section }: { section: Section }) {
  const portfolio = usePortfolio();
  const { openAdd } = useOutletContext<LayoutContext>();

  return (
    <>
      {section.path && (
        <header className="invest-head">
          <h2>{section.label}</h2>
          <p>{section.description}</p>
        </header>
      )}

      {portfolio.isPending && <SectionSkeleton />}

      {portfolio.isError && (
        <div className="notice error" role="alert">
          <AlertTriangle size={16} />
          <div>
            {portfolio.error.message} <button className="btn btn-link" onClick={() => portfolio.refetch()}>Try again</button>
          </div>
        </div>
      )}

      {portfolio.data && portfolio.data.holdings.length === 0 && (
        <div className="summary-card" style={{ padding: 32, maxWidth: 680 }}>
          <h2 className="display" style={{ fontSize: 30 }}>Track every SIP without typing in a single old statement.</h2>
          <p className="lede" style={{ marginTop: 12 }}>
            Choose your fund, enter the SIP amount and the date it started. Every installment is rebuilt from the published
            NAVs, including the ones that fell on a market holiday.
          </p>
          <div style={{ marginTop: 22 }}>
            <Button variant="primary" icon={<Plus size={15} />} onClick={openAdd}>Add your first fund</Button>
          </div>
        </div>
      )}

      {portfolio.data && portfolio.data.holdings.length > 0 && section.render(portfolio.data)}

      {portfolio.data && portfolio.data.holdings.length > 0 && (
        <p className="disclaimer invest-foot">
          NAVs refresh nightly after midnight IST. Installments due on a weekend or market holiday use the next trading day's
          NAV. Units are after 0.005% stamp duty. For tracking only — not investment advice.
        </p>
      )}
    </>
  );
}

function SectionSkeleton() {
  return (
    <div className="summary-card" aria-busy="true">
      <Skeleton height={12} width={100} />
      <Skeleton height={42} width={260} style={{ marginTop: 10 }} />
      <Skeleton height={14} width={180} style={{ marginTop: 12 }} />
      <Skeleton height={260} style={{ marginTop: 28 }} />
    </div>
  );
}
