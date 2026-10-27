import type {
  Budget,
  CandidateCheck,
  ChartPreset,
  HealthResponse,
  InvestmentProfile,
  Overlap,
  PortfolioAlert,
  ProjectionResponse,
  ChartRange,
  FundSeries,
  Goal,
  GoalInput,
  HarvestPlan,
  SearchMatch,
  TimelinePoint,
  Expense,
  Forecast,
  HoldingDetail,
  InvestmentInput,
  InvestmentPreview,
  NewExpense,
  NewRecurringExpense,
  Options,
  Portfolio,
  RecurringExpense,
  SchemeDetail,
  SchemeSearchResult,
  SettingsState,
  User
} from "./types";

const TOKEN_KEY = "spendcast.token";
export const UNAUTHORIZED_EVENT = "spendcast:unauthorized";

// Storage can be unavailable (private mode, blocked site data), so every
// access is guarded and the app still works for the current page load.
let memoryToken: string | null = null;

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? memoryToken;
    } catch {
      return memoryToken;
    }
  },
  set(token: string) {
    memoryToken = token;
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* keep the in-memory copy */
    }
  },
  clear() {
    memoryToken = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing stored */
    }
  }
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

type Query = Record<string, string | number | undefined>;

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }

  const url = `/api/v1${path}${params.size ? `?${params}` : ""}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = tokenStore.get();

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }

  const data = await response.json().catch(() => ({}));

  if (response.status === 401 && token) {
    // The session expired or the account is gone: sign out everywhere.
    tokenStore.clear();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }

  if (!response.ok) {
    throw new ApiError(data.error || `Request failed (${response.status}).`, response.status);
  }

  return data as T;
}

export const api = {
  options: () => request<Options & { success: true }>("GET", "/options"),

  register: (input: { name: string; email: string; password: string; timezone: string; currency: string }) =>
    request<{ token: string; user: User }>("POST", "/auth/register", input),
  login: (input: { email: string; password: string }) =>
    request<{ token: string; user: User }>("POST", "/auth/login", input),
  me: () => request<{ user: User }>("GET", "/auth/me"),

  settings: () => request<SettingsState>("GET", "/settings"),
  updateSettings: (changes: Partial<{ timezone: string; currency: string }>) =>
    request<SettingsState>("PUT", "/settings", changes),

  budget: () => request<{ budget: Budget | null }>("GET", "/budget"),
  setBudget: (amount: number) => request<{ budget: Budget }>("PUT", "/budget", { amount }),

  expenses: (query: { from?: string; to?: string; limit?: number }) =>
    request<{ expenses: Expense[] }>("GET", "/expenses", undefined, query),
  createExpense: (input: NewExpense) => request<{ expense: Expense }>("POST", "/CreateExpenses", input),
  deleteExpense: (id: string) => request<{ success: true }>("DELETE", `/expenses/${id}`),

  recurring: () => request<{ recurringExpenses: RecurringExpense[] }>("GET", "/recurring-expenses"),
  createRecurring: (input: NewRecurringExpense) =>
    request<{ recurringExpense: RecurringExpense }>("POST", "/recurring-expenses", input),
  updateRecurring: (id: string, changes: { isActive?: boolean; endDate?: string | null }) =>
    request<{ recurringExpense: RecurringExpense }>("PATCH", `/recurring-expenses/${id}`, changes),

  forecast: (months: number) => request<Forecast>("GET", "/forecast", undefined, { months }),

  searchFunds: (q: string) => request<{ results: SchemeSearchResult[]; match: SearchMatch }>("GET", "/mf/search", undefined, { q }),
  fundSeries: (schemeCodes: number[]) =>
    request<{ funds: FundSeries[]; combined: TimelinePoint[] }>("GET", "/portfolio/series", undefined, { codes: schemeCodes.join(",") }),
  chartPresets: () => request<{ presets: ChartPreset[] }>("GET", "/portfolio/chart-presets"),
  saveChartPresets: (presets: ChartPreset[]) => request<{ presets: ChartPreset[] }>("PUT", "/portfolio/chart-presets", { presets }),
  fund: (code: number, range: ChartRange) => request<SchemeDetail>("GET", `/mf/schemes/${code}`, undefined, { range }),
  portfolio: () => request<Portfolio>("GET", "/portfolio"),
  harvest: (booked: number) => request<HarvestPlan>("GET", "/portfolio/harvest", undefined, { booked: String(booked) }),
  goals: () => request<{ goals: Goal[] }>("GET", "/goals").then(result => result.goals),
  previewGoal: (input: GoalInput) => request<{ goal: Goal }>("POST", "/goals/preview", input).then(result => result.goal),
  createGoal: (input: GoalInput) => request<{ goal: Goal }>("POST", "/goals", input).then(result => result.goal),
  updateGoal: (id: string, input: GoalInput) => request<{ goal: Goal }>("PATCH", `/goals/${id}`, input).then(result => result.goal),
  deleteGoal: (id: string) => request<{ id: string }>("DELETE", `/goals/${id}`),
  holding: (schemeCode: string, range: ChartRange) => request<HoldingDetail>("GET", `/holdings/${schemeCode}`, undefined, { range }),
  deleteHolding: (schemeCode: string) => request<{ removed: number }>("DELETE", `/holdings/${schemeCode}`),
  previewInvestment: (input: InvestmentInput) => request<{ preview: InvestmentPreview }>("POST", "/investments/preview", input),
  createInvestment: (input: InvestmentInput) => request<HoldingDetail & { investmentId: string }>("POST", "/investments", input),
  updateInvestment: (id: string, changes: Partial<InvestmentInput> & { isActive?: boolean; skippedDates?: string[] }) =>
    request<HoldingDetail>("PATCH", `/investments/${id}`, changes),
  deleteInvestment: (id: string) => request<{ schemeCode: number; remaining: number }>("DELETE", `/investments/${id}`),

  overlap: () => request<Overlap>("GET", "/portfolio/overlap"),
  checkCandidate: (schemeCode: number, amount?: number) =>
    request<CandidateCheck>("POST", "/portfolio/overlap/candidate", amount ? { schemeCode, amount } : { schemeCode }),
  projection: (extra: number) => request<ProjectionResponse>("GET", "/portfolio/projection", undefined, { extra: extra ? String(extra) : undefined }),
  health: () => request<HealthResponse>("GET", "/portfolio/health"),
  profile: () => request<{ profile: InvestmentProfile }>("GET", "/portfolio/profile").then(result => result.profile),
  saveProfile: (profile: InvestmentProfile) => request<{ profile: InvestmentProfile }>("PUT", "/portfolio/profile", profile).then(result => result.profile),
  alerts: () => request<{ alerts: PortfolioAlert[] }>("GET", "/alerts").then(result => result.alerts),
  updateAlert: (id: string, status: "dismissed" | "open") =>
    request<{ alert: PortfolioAlert }>("PATCH", `/alerts/${id}`, { status }).then(result => result.alert)
};
