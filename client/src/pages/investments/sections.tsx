import type { ReactNode } from "react";
import { type LucideIcon, BarChart3, CalendarClock, HeartPulse, LayoutDashboard, List, Receipt, Target } from "lucide-react";
import type { Portfolio, PortfolioAlert } from "../../lib/types";
import { OverviewPage } from "./OverviewPage";
import { HoldingsPage } from "./HoldingsPage";
import { SipsPage } from "./SipsPage";
import { HealthPage } from "./HealthPage";
import { PerformancePage } from "./PerformancePage";
import { PlanningPage } from "./PlanningPage";
import { TaxPage } from "./TaxPage";

/*
 * Every Investments section, in one list. The side menu, the phone menu, the
 * menu search, the Overview's "explore" grid and the routes are all built from
 * it, so adding a section is one entry here plus its page component.
 *
 * Related tools share a page rather than each taking a menu item: a section
 * groups everything that answers one question (is it built well? how has it
 * done? will I get there?).
 */

export interface Section {
  // URL segment under /investments; "" is the Overview.
  path: string;
  label: string;
  // One line for the page header and the Overview grid.
  description: string;
  icon: LucideIcon;
  // Extra words the menu search matches.
  keywords?: string;
  // Open alerts of these types are counted on the section's menu item.
  alertTypes?: PortfolioAlert["type"][];
  // A count shown on the menu item, from the portfolio.
  count?: (data: Portfolio) => number | null;
  // Old paths that now live on this page: path -> anchor on the page.
  aliases?: Record<string, string>;
  // Rendered once the portfolio has loaded and holds at least one fund.
  render: (data: Portfolio) => ReactNode;
}

export interface SectionGroup {
  id: string;
  label: string;
  sections: Section[];
}

// Closures, not elements, so the pages (which import this list for the
// Overview grid) are only touched when rendered.
export const SECTION_GROUPS: SectionGroup[] = [
  {
    id: "portfolio",
    label: "Portfolio",
    sections: [
      { path: "", label: "Overview", description: "Your value, today's move, and anything worth a look.", icon: LayoutDashboard, keywords: "summary home alerts today", alertTypes: ["reconcile"], render: data => <OverviewPage data={data} /> },
      { path: "holdings", label: "Holdings", description: "Every fund you hold, with its returns.", icon: List, keywords: "funds units xirr", count: data => data.holdings.length, render: data => <HoldingsPage data={data} /> },
      { path: "sips", label: "SIPs", description: "Upcoming debits and every SIP, active or stopped.", icon: CalendarClock, keywords: "debits mandate monthly installments", count: data => data.sips.active.length, render: data => <SipsPage data={data} /> }
    ]
  },
  {
    id: "insights",
    label: "Insights",
    sections: [
      {
        path: "health",
        label: "Health",
        description: "Is your portfolio built well? The score, what your funds own together, and your mix.",
        icon: HeartPulse,
        keywords: "score risk cost expense ratio drift overlap companies sectors diversification duplicate look-through allocation category amc",
        alertTypes: ["underperformance", "concentration"],
        aliases: { overlap: "overlap" },
        render: data => <HealthPage data={data} />
      },
      {
        path: "performance",
        label: "Performance",
        description: "How have your funds done? Against the market, and against each other.",
        icon: BarChart3,
        keywords: "nifty benchmark contribution returns compare chart builder presets analysis",
        aliases: { compare: "compare", analysis: "" },
        render: data => <PerformancePage data={data} />
      }
    ]
  },
  {
    id: "planning",
    label: "Planning",
    sections: [
      {
        path: "planning",
        label: "Goals & forecast",
        description: "Will you get there? Your goals' chances, and where your money could be.",
        icon: Target,
        keywords: "goals target house car education odds forecast projection future scenarios sip calculator",
        alertTypes: ["goal"],
        aliases: { goals: "goals", forecast: "forecast" },
        render: data => <PlanningPage data={data} />
      },
      { path: "tax", label: "Tax", description: "Tax if you sold today, and this year's tax-free harvest.", icon: Receipt, keywords: "ltcg stcg capital gains harvest exemption", render: data => <TaxPage data={data} /> }
    ]
  }
];

export const ALL_SECTIONS = SECTION_GROUPS.flatMap(group => group.sections);

export function matchesSearch(section: Section, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${section.label} ${section.description} ${section.keywords ?? ""}`.toLowerCase();
  return words.every(word => text.includes(word));
}

export const sectionUrl = (section: Section) => (section.path ? `/investments/${section.path}` : "/investments");

// Old paths (and old ?tab= values) -> where that content lives now.
export const MOVED: Record<string, string> = Object.fromEntries(
  ALL_SECTIONS.flatMap(section => Object.entries(section.aliases ?? {}).map(([alias, anchor]) => [alias, `${sectionUrl(section)}${anchor ? `#${anchor}` : ""}`]))
);

export function legacyTabUrl(tab: string): string | null {
  if (MOVED[tab]) return MOVED[tab];
  const section = ALL_SECTIONS.find(item => item.path === tab && item.path);
  return section ? sectionUrl(section) : null;
}
