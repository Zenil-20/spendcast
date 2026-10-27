// Shapes of the server's JSON responses (server/controller/*).

export type BudgetStatus = "within_budget" | "at_risk" | "over_budget" | "budget_not_set";
export type Frequency = "monthly" | "quarterly" | "yearly";

export interface Settings {
  timezone: string;
  currency: string;
}

export interface PendingChange extends Settings {
  requestedAt: string;
  effectiveAt: string;
}

export interface SettingsState {
  settings: Settings;
  pendingChange: PendingChange | null;
}

export interface User extends SettingsState {
  id: string;
  name: string;
  email: string;
}

export interface Options {
  timezones: string[];
  currencies: string[];
  paymentMethods: string[];
  frequencies: Frequency[];
}

export interface Expense {
  id: string;
  title: string;
  amount: number;
  currency: string;
  category: string;
  date: string;
  localDate: string;
  paymentMethod: string;
  notes: string;
  recurringExpenseId: string | null;
}

export interface RecurringExpense {
  id: string;
  title: string;
  category: string;
  amount: number;
  currency: string;
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
}

export interface Budget {
  amount: number;
  currency: string;
  matchesCurrentCurrency: boolean;
}

export interface Range {
  low: number;
  high: number;
}

export interface ScheduledPayment {
  recurringExpenseId: string;
  title: string;
  category: string;
  amount: number;
  frequency: Frequency;
  dueDate: string;
}

export interface HistoryMonth {
  year: number;
  month: number;
  monthLabel: string;
  totalExpenditure: number;
  recurringExpenditure: number;
  variableExpenditure: number;
  expenseCount: number;
}

export interface BudgetComparison {
  budget: number | null;
  budgetDifference: number | null;
  budgetStatus: BudgetStatus;
}

export interface CurrentMonth extends BudgetComparison {
  year: number;
  month: number;
  monthLabel: string;
  daysElapsed: number;
  daysInMonth: number;
  spentSoFar: number;
  recurringSpentSoFar: number;
  variableSpentSoFar: number;
  expectedRemainingVariableExpenditure: number;
  upcomingRecurringExpenditure: number;
  projectedTotalExpenditure: number;
  projectedTotalRange: Range;
  upcomingRecurringPayments: ScheduledPayment[];
}

export interface ForecastMonth extends BudgetComparison {
  year: number;
  month: number;
  monthLabel: string;
  estimatedVariableExpenditure: number;
  variableExpenditureRange: Range;
  seasonalFactor: number;
  expectedRecurringExpenditure: number;
  estimatedTotalExpenditure: number;
  estimatedTotalRange: Range;
  recurringPayments: ScheduledPayment[];
}

export interface Forecast {
  timezone: string;
  currency: string;
  asOf: string;
  message?: string;
  method?: string;
  dataCoverage?: "limited" | "moderate" | "strong";
  historicalMonthsUsed?: number;
  usedPartialMonth?: boolean;
  accuracy?: {
    evaluatedMonths: number;
    meanAbsoluteError: number;
    weightedAbsolutePercentageError: number;
  } | null;
  warnings: string[];
  limitations?: string[];
  monthlyHistory: HistoryMonth[];
  currentMonth: CurrentMonth | null;
  forecast: ForecastMonth[] | null;
}

export interface NewExpense {
  title: string;
  amount: number;
  category: string;
  date: string;
  paymentMethod: string;
  notes?: string;
  recurringExpenseId?: string | null;
}

export interface NewRecurringExpense {
  title: string;
  amount: number;
  category: string;
  frequency: Frequency;
  startDate: string;
  endDate?: string | null;
}

/* ---------- Mutual funds ---------- */

export interface SchemeSearchResult {
  schemeCode: number;
  schemeName: string;
  isinGrowth: string | null;
  isinDivReinvestment: string | null;
}

export interface SchemeMeta {
  schemeName: string | null;
  fundHouse: string | null;
  schemeType: string | null;
  schemeCategory: string | null;
  isinGrowth: string | null;
  isinDivReinvestment: string | null;
}

export interface NavPoint {
  date: string;
  nav: number;
}

export type ReturnPeriod = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y";
export type ChartRange = ReturnPeriod | "ALL";

export type EntryZone = "below" | "usual" | "above";

export interface ZoneOutcome {
  averageReturn: number;
  positiveShare: number;
  samples: number;
}

// Where today's NAV sits against its 200-day average, and how buying in each
// zone worked out over the next year in this fund's history.
export interface EntrySignal {
  zone: EntryZone;
  deviation: number;
  percentile: number;
  average200: number;
  thresholds: { below: number; above: number };
  history: Record<EntryZone, ZoneOutcome | null>;
  horizonDays: number;
  since: string;
  asOf: string;
}

export type SearchMatch = "exact" | "fuzzy" | "partial" | "none";

export interface FundSeries {
  schemeCode: number;
  shortName: string;
  points: TimelinePoint[];
}

export type ChartMetric = "value" | "invested" | "gain" | "returnPercent";
export type ChartMode = "separate" | "combined";

export interface ChartPreset {
  id: string;
  name: string;
  schemeCodes: number[];
  metric: ChartMetric;
  mode: ChartMode;
}

export interface FundMetrics {
  returns: Record<ReturnPeriod, number | null>;
  entry?: EntrySignal | null;
  sipDates?: SipDateStudy | null;
  risk: {
    period: { from: string; to: string };
    annualReturn: number | null;
    volatility: number | null;
    sharpe: number | null;
    sortino: number | null;
    maxDrawdown: { drawdown: number; peakDate: string; troughDate: string };
    beta: number | null;
    alpha: number | null;
    correlation: number | null;
    benchmarkReturn?: number | null;
  } | null;
  price: {
    high52w: number;
    low52w: number;
    fromHigh: number;
    fromLow: number;
    rangePosition: number;
    average200: number | null;
    fromAverage200: number | null;
  } | null;
}

export interface SchemeDetail {
  schemeCode: number;
  meta: SchemeMeta;
  assetClass: string;
  category: string;
  latestNav: NavPoint | null;
  firstNavDate: string | null;
  metrics: FundMetrics;
  chart: NavPoint[];
  benchmarkChart: NavPoint[];
  benchmarkName: string | null;
}

export type InvestmentKind = "sip" | "lumpsum";

export interface Installment {
  dueDate: string;
  amount: number;
  status: "allotted" | "awaiting_nav" | "skipped";
  // The SIP or one-time purchase this belongs to.
  investmentId?: string;
  source?: InvestmentKind;
  navDate?: string;
  nav?: number;
  stampDuty?: number;
  units?: number;
  shifted?: boolean;
}

export interface NextInstallment {
  dueDate: string;
  amount: number;
  onWeekend: boolean;
  estimatedUnits?: number;
  atNav?: number;
  atNavDate?: string;
}

export interface TaxLots {
  equity: boolean;
  longTermGain: number;
  shortTermGain: number;
  slabGain: number;
  turningLongTerm: { gain: number; units: number; firstDate: string | null };
}

export interface TaxEstimate {
  shortTermTax: number;
  longTermTax: number;
  total: number;
  exemptionUsed: number;
}

// One SIP or one-time purchase inside a fund holding.
export interface InvestmentSummary {
  id: string;
  kind: InvestmentKind;
  amount: number;
  sipDay: number | null;
  startDate: string;
  endDate: string | null;
  stepUpPercent: number;
  stopped: boolean;
  invested: number;
  units: number;
  installmentsAllotted: number;
  notDebited: number;
  next: NextInstallment | null;
}

// Everything held in one fund: its SIPs and one-time purchases combined.
export interface Holding {
  id: string;
  schemeCode: number;
  schemeName: string;
  shortName: string;
  plan: "Direct" | "Regular" | null;
  option: "Growth" | "IDCW" | null;
  fundHouse: string | null;
  assetClass: string;
  category: string;
  monthlySip: number;
  activeSipCount: number;
  purchaseCount: number;
  investments: InvestmentSummary[];
  latestNav: NavPoint | null;
  units: number;
  invested: number;
  value: number;
  gain: number;
  absoluteReturn: number | null;
  averageCost: number | null;
  dayChange: number;
  dayChangePercent: number | null;
  xirr: number | null;
  holdingDays: number;
  installmentsAllotted: number;
  awaitingNav: number;
  notDebited: number;
  next: NextInstallment | null;
  equityTaxed: boolean;
  tax: TaxLots;
  entry: { zone: EntryZone; percentile: number } | null;
  fundReturn1Y: number | null;
  fundReturn3Y: number | null;
  benchmarkReturn1Y: number | null;
  benchmarkReturn3Y: number | null;
}

export interface AllocationEntry {
  name: string;
  value: number;
  invested: number;
  count: number;
  share: number;
}

export interface TimelinePoint {
  date: string;
  value: number;
  invested: number;
}

export interface Insight {
  id: string;
  tone: "positive" | "attention" | "info";
  title: string;
  detail: string;
}

export interface ActiveSip {
  id: string;
  investmentId: string;
  shortName: string;
  schemeName: string;
  amount: number;
  baseAmount: number;
  sipDay: number | null;
  stepUpPercent: number;
  startDate: string;
  installmentsAllotted: number;
  invested: number;
  next: NextInstallment | null;
}

export interface TodayMove {
  date: string;
  change: number;
  percent: number | null;
  benchmarkPercent: number | null;
  // Installments allotted that day: money added, not a gain.
  newMoney: number;
  movers: { id: string; shortName: string; change: number; percent: number }[];
  // Funds whose NAV for that day isn't published yet.
  pending: string[];
}

export interface HarvestPlan {
  financialYear: string;
  deadline: string;
  daysLeft: number;
  exemption: number;
  alreadyBooked: number;
  remaining: number;
  available: number;
  plan: {
    schemeCode: number;
    shortName: string;
    units: number;
    amount: number;
    gain: number;
    nav: number;
    navDate: string;
    oldestLot: string;
    rebuyStampDuty: number;
  }[];
  gainBooked: number;
  taxAvoided: number;
  costs: number;
  earliestLongTerm: { date: string; shortName: string } | null;
}

export interface SipDateStudy {
  from: string;
  to: string;
  months: number;
  amount: number;
  invested: number;
  days: { day: number; value: number; xirr: number | null }[];
  best: number;
  worst: number;
  spread: number;
  medianGap: number;
}

export interface GoalSimulation {
  probability: number;
  months: number;
  target: number;
  current: number;
  monthlyContribution: number;
  stepUpPercent: number;
  totalInvested: number;
  outcomes: { p10: number; p25: number; median: number; p75: number; p90: number };
  neededMonthly: { odds50: number | null; odds75: number | null; odds90: number | null };
  flatRate: { rate: number; value: number };
  fan: { date: string; p10: number; median: number; p90: number }[];
  history: { from: string; to: string; months: number; paths: number; blockMonths: number; borrowedMonths: number; fundMonths: number[] };
  neededTopUp: number | null;
  shortfall: { probability: number; median: number; badCase: number };
}

export interface GoalInput {
  name: string;
  targetAmount: number;
  targetDate: string;
  schemeCodes: number[];
  // null: use the current SIPs of the chosen funds.
  monthlyContribution: number | null;
  stepUpPercent: number;
}

export interface Goal extends GoalInput {
  id: string | null;
  today: string;
  funds: { schemeCode: number; shortName: string; value: number; monthlySip: number; historyMonths: number | null }[];
  currentSips: number;
  effectiveMonthly: number;
  benchmarkName: string | null;
  simulation: GoalSimulation | null;
  watch: GoalWatch | null;
}

export interface Portfolio {
  currency: string;
  today: string;
  asOf: string | null;
  todayMove: TodayMove | null;
  harvest: HarvestPlan;
  totals: {
    invested: number;
    value: number;
    gain: number;
    absoluteReturn: number | null;
    dayChange: number;
    dayChangePercent: number | null;
    xirr: number | null;
    annualised: boolean;
  };
  market: { value: number; xirr: number | null; difference: number; benchmarkName: string | null } | null;
  tax: {
    longTermGain: number;
    shortTermGain: number;
    slabGain: number;
    estimate: TaxEstimate;
    exemption: number;
    rates: { longTerm: number; shortTerm: number; cess: number };
    turningLongTerm: { id: string; shortName: string; gain: number; units: number; firstDate: string }[];
    turningLongTermGain: number;
  };
  sips: {
    monthlyTotal: number;
    remainingThisMonth: number;
    nextWeekTotal: number;
    active: ActiveSip[];
    stopped: { id: string; investmentId: string; shortName: string; amount: number; sipDay: number | null; startDate: string; endDate: string | null; installmentsAllotted: number; invested: number }[];
  };
  insights: Insight[];
  contribution: { id: string; shortName: string; gain: number; share: number }[];
  calendar: { lastTradingDay: string; todayIsWeekend: boolean; recentHolidays: string[] } | null;
  allocation: { byAssetClass: AllocationEntry[]; byCategory: AllocationEntry[]; byFundHouse: AllocationEntry[] };
  timeline: TimelinePoint[];
  holdings: Holding[];
}

export interface HoldingDetail {
  currency: string;
  today: string;
  holding: Holding & { installments: Installment[] };
  meta: SchemeMeta;
  metrics: FundMetrics & { benchmarkReturns: Record<ReturnPeriod, number | null> };
  market: { value: number; xirr: number | null; difference: number } | null;
  taxEstimate: TaxEstimate | null;
  chart: NavPoint[];
  benchmarkChart: NavPoint[];
  benchmarkName: string | null;
}

export interface InvestmentInput {
  schemeCode: number;
  kind: InvestmentKind;
  amount: number;
  sipDay?: number;
  startDate: string;
  endDate?: string | null;
  stepUpPercent?: number;
}

export interface InvestmentPreview {
  kind: InvestmentKind;
  latestNav: NavPoint | null;
  units: number;
  invested: number;
  value: number;
  gain: number;
  absoluteReturn: number | null;
  installmentsAllotted: number;
  awaitingNav: number;
  next: NextInstallment | null;
  shiftedCount: number;
  firstAllotment: Installment | null;
  lastAllotment: Installment | null;
}

/* ---------- Goal early warning ---------- */

export type GoalStatus = "on_track" | "at_risk" | "off_track";

export type GoalFixOption =
  | { kind: "monthly"; amount: number; monthly: number }
  | { kind: "topUp"; amount: number }
  | { kind: "extend"; months: number; date: string | null };

export interface GoalWatch {
  status: GoalStatus;
  probability: number;
  trend: { from: string | null; previous: number | null; change: number | null; behindDays: number };
  fix: { odds: number; primary: GoalFixOption["kind"] | null; options: GoalFixOption[] } | null;
}

/* ---------- Overlap ---------- */

export interface FundRef {
  schemeCode: number;
  shortName: string;
}

export interface ExposureFund extends FundRef {
  weight: number;
  amount: number;
}

export interface CompanyExposure {
  key: string;
  isin: string | null;
  name: string;
  sector: string | null;
  assetType: "equity" | "debt" | "other";
  amount: number;
  share: number;
  portfolioShare: number;
  funds: ExposureFund[];
}

export interface SectorExposure {
  sector: string;
  amount: number;
  share: number;
  duplicated: boolean;
  heavyFunds: number;
  funds: ExposureFund[];
}

export interface FundPairOverlap {
  a: FundRef;
  b: FundRef;
  overlap: number;
  commonCount: number;
  topShared: string[];
}

export interface FundCorrelation {
  a: FundRef;
  b: FundRef;
  correlation: number | null;
  months: number;
  label: string;
}

export interface Overlap {
  asOf: string;
  method: "holdings" | "partial" | "returns";
  summary: string[];
  coverage: {
    value: number;
    total: number;
    share: number;
    funds: (FundRef & { asOf: string; stale: boolean })[];
    missing: (FundRef & { value: number })[];
  };
  companyCount: number;
  companies: CompanyExposure[];
  common: CompanyExposure[];
  commonCount: number;
  commonShare: number;
  sectors: SectorExposure[];
  pairs: FundPairOverlap[];
  cash: { label: string; amount: number; share: number };
  concentration: { hhi: number | null; effectiveHoldings: number | null; top10Share: number | null; largest: { name: string; share: number; funds: number } | null };
  correlations: FundCorrelation[];
}

export interface CandidateCheck {
  schemeCode: number;
  shortName: string;
  amount: number;
  alreadyHeld: boolean;
  method: "holdings" | "returns" | "none";
  verdict: "improves" | "marginal" | "duplicates" | "unknown";
  reasons: string[];
  correlation?: number | null;
  overlapWithPortfolio?: number;
  newHoldings?: number;
  effectiveHoldings?: { before: number; after: number; change: number | null };
}

/* ---------- Forecast ---------- */

export interface ProjectionHorizon {
  months: number;
  date: string;
  contributed: number;
  invested: number;
  pessimistic: number;
  baseline: number;
  optimistic: number;
  p25: number;
  p75: number;
  lossProbability: number;
}

export interface Projection {
  asOf: string;
  current: number;
  currentMonthly: number;
  monthly: number;
  change: number;
  horizons: ProjectionHorizon[];
  fan: { date: string; p10: number; p25: number; median: number; p75: number; p90: number }[];
  sensitivity: { months: number; rows: { monthly: number; change: number; pessimistic: number; baseline: number; optimistic: number }[] };
  assumptions: {
    history: { from: string; to: string; months: number; paths: number; blockMonths: number };
    funds: (FundRef & { borrowedMonths: number; missRate: number; upcomingInstallments: number; missed: number; scheduled: number })[];
    stepUpsIncluded: boolean;
    contributionTiming: string;
    excludes: string[];
  };
}

export interface ProjectionResponse {
  asOf: string;
  benchmarkName?: string | null;
  projection: Projection | null;
  reason?: string;
}

/* ---------- Health ---------- */

export type HealthFactorKey = "concentration" | "overlap" | "riskVsHorizon" | "cost" | "benchmarkRelative" | "allocationDrift";

export interface HealthFactor {
  key: HealthFactorKey;
  label: string;
  weight: number;
  score: number | null;
  reason?: string;
  evidence: string[];
}

export interface HealthChange {
  date: string;
  from: number;
  to: number;
  change: number;
  reasons: { key: HealthFactorKey; label: string; impact: number; text: string; details: string[] }[];
}

export interface InvestmentProfile {
  horizonYears: number | null;
  targetAllocation: { equity: number; debt: number; hybrid: number; other: number } | null;
}

export interface HealthResponse {
  asOf: string;
  health: { score: number | null; grade: string | null; coverage: number; factors: HealthFactor[] } | null;
  changes: { sinceLast: HealthChange | null; sinceMonth: HealthChange | null } | null;
}

/* ---------- Alerts ---------- */

export interface PortfolioAlert {
  id: string;
  key: string;
  type: "underperformance" | "concentration" | "goal" | "reconcile";
  severity: "info" | "warning";
  status: "open" | "dismissed" | "resolved";
  title: string;
  why: string;
  period: { from?: string; to?: string } | null;
  evidence: { columns: string[]; rows: string[][] } | null;
  investigate: string[];
  link: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}
