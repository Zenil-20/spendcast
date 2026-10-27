import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { ChartPreset, ChartRange, GoalInput, InvestmentInput, InvestmentProfile, NewExpense, NewRecurringExpense } from "./types";

// Query keys. Anything that changes spending also invalidates the forecast.
export const keys = {
  options: ["options"] as const,
  forecast: (months: number) => ["forecast", months] as const,
  expenses: (from: string, to: string) => ["expenses", from, to] as const,
  recurring: ["recurring"] as const,
  budget: ["budget"] as const,
  settings: ["settings"] as const
};

export function useOptions() {
  return useQuery({ queryKey: keys.options, queryFn: api.options, staleTime: Infinity });
}

export function useForecast(months: number) {
  return useQuery({ queryKey: keys.forecast(months), queryFn: () => api.forecast(months) });
}

export function useExpenses(from: string, to: string) {
  return useQuery({
    queryKey: keys.expenses(from, to),
    queryFn: () => api.expenses({ from, to, limit: 500 }).then(result => result.expenses)
  });
}

export function useRecurring() {
  return useQuery({ queryKey: keys.recurring, queryFn: () => api.recurring().then(result => result.recurringExpenses) });
}

export function useBudget() {
  return useQuery({ queryKey: keys.budget, queryFn: () => api.budget().then(result => result.budget) });
}

function useInvalidateSpending() {
  const queryClient = useQueryClient();

  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["forecast"] }),
    queryClient.invalidateQueries({ queryKey: ["expenses"] }),
    queryClient.invalidateQueries({ queryKey: keys.recurring }),
    queryClient.invalidateQueries({ queryKey: keys.budget })
  ]);
}

export function useCreateExpense() {
  const invalidate = useInvalidateSpending();
  return useMutation({ mutationFn: (input: NewExpense) => api.createExpense(input), onSuccess: invalidate });
}

export function useDeleteExpense() {
  const invalidate = useInvalidateSpending();
  return useMutation({ mutationFn: (id: string) => api.deleteExpense(id), onSuccess: invalidate });
}

export function useCreateRecurring() {
  const invalidate = useInvalidateSpending();
  return useMutation({ mutationFn: (input: NewRecurringExpense) => api.createRecurring(input), onSuccess: invalidate });
}

export function useUpdateRecurring() {
  const invalidate = useInvalidateSpending();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: { isActive?: boolean; endDate?: string | null } }) =>
      api.updateRecurring(id, changes),
    onSuccess: invalidate
  });
}

export function useSetBudget() {
  const invalidate = useInvalidateSpending();
  return useMutation({ mutationFn: (amount: number) => api.setBudget(amount), onSuccess: invalidate });
}

/* ---------- Mutual funds ---------- */

export function usePortfolio() {
  return useQuery({ queryKey: ["portfolio"], queryFn: api.portfolio, staleTime: 5 * 60_000 });
}

// Harvest for a given amount of gains already booked; 0 is in the portfolio.
export function useHarvest(booked: number) {
  return useQuery({
    queryKey: ["harvest", booked],
    queryFn: () => api.harvest(booked),
    enabled: booked > 0,
    staleTime: 5 * 60_000,
    placeholderData: previous => previous
  });
}

export function useGoals() {
  return useQuery({ queryKey: ["goals"], queryFn: api.goals, staleTime: 5 * 60_000 });
}

// Live odds while a goal is being edited; `input` null means "not valid yet".
export function useGoalPreview(input: GoalInput | null) {
  return useQuery({
    queryKey: ["goal-preview", input],
    queryFn: () => api.previewGoal(input!),
    enabled: input !== null,
    staleTime: 60_000,
    placeholderData: previous => previous,
    retry: false
  });
}

export function useSaveGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: GoalInput }) => (id ? api.updateGoal(id, input) : api.createGoal(input)),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ["goals"] }), queryClient.invalidateQueries({ queryKey: ["analytics"] })])
  });
}

export function useDeleteGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteGoal(id),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ["goals"] }), queryClient.invalidateQueries({ queryKey: ["analytics"] })])
  });
}

export function useHolding(id: string, range: ChartRange) {
  return useQuery({
    queryKey: ["holding", id, range],
    queryFn: () => api.holding(id, range),
    placeholderData: previous => previous,
    staleTime: 5 * 60_000
  });
}

export function useFundSearch(query: string) {
  const term = query.trim();
  return useQuery({
    queryKey: ["fund-search", term.toLowerCase()],
    queryFn: () => api.searchFunds(term),
    enabled: term.length >= 2,
    staleTime: 10 * 60_000,
    placeholderData: previous => previous
  });
}

export function useFundSeries(schemeCodes: number[]) {
  const key = [...schemeCodes].sort((a, b) => a - b);
  return useQuery({
    queryKey: ["fund-series", key.join(",")],
    queryFn: () => api.fundSeries(key),
    // An empty list means "all funds" to the API; the builder never wants that.
    enabled: key.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: previous => previous
  });
}

export function useChartPresets() {
  return useQuery({ queryKey: ["chart-presets"], queryFn: () => api.chartPresets().then(result => result.presets) });
}

export function useSaveChartPresets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (presets: ChartPreset[]) => api.saveChartPresets(presets).then(result => result.presets),
    onSuccess: presets => queryClient.setQueryData(["chart-presets"], presets)
  });
}

export function useFund(code: number | null, range: ChartRange = "1Y") {
  return useQuery({
    queryKey: ["fund", code, range],
    queryFn: () => api.fund(code!, range),
    enabled: code !== null,
    staleTime: 10 * 60_000
  });
}

function useInvalidateInvestments() {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["portfolio"] }),
    queryClient.invalidateQueries({ queryKey: ["holding"] }),
    queryClient.invalidateQueries({ queryKey: ["fund-series"] }),
    queryClient.invalidateQueries({ queryKey: ["goals"] }),
    queryClient.invalidateQueries({ queryKey: ["harvest"] }),
    queryClient.invalidateQueries({ queryKey: ["analytics"] })
  ]);
}

/* ---------- Portfolio analytics ---------- */

// All under ["analytics", ...] so a change to investments refreshes them together.
export function useOverlap(enabled = true) {
  return useQuery({ queryKey: ["analytics", "overlap"], queryFn: api.overlap, enabled, staleTime: 5 * 60_000 });
}

export function useCandidateCheck() {
  return useMutation({ mutationFn: ({ schemeCode, amount }: { schemeCode: number; amount?: number }) => api.checkCandidate(schemeCode, amount) });
}

// The forecast for a changed monthly SIP total; `extra` 0 is the current plan.
export function useProjection(extra: number) {
  return useQuery({
    queryKey: ["analytics", "projection", extra],
    queryFn: () => api.projection(extra),
    staleTime: 5 * 60_000,
    placeholderData: previous => previous
  });
}

export function useHealth() {
  return useQuery({ queryKey: ["analytics", "health"], queryFn: api.health, staleTime: 5 * 60_000 });
}

export function useProfile() {
  return useQuery({ queryKey: ["profile"], queryFn: api.profile });
}

export function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profile: InvestmentProfile) => api.saveProfile(profile),
    onSuccess: profile => {
      queryClient.setQueryData(["profile"], profile);
      return queryClient.invalidateQueries({ queryKey: ["analytics", "health"] });
    }
  });
}

export function useAlerts() {
  return useQuery({ queryKey: ["analytics", "alerts"], queryFn: api.alerts, staleTime: 5 * 60_000 });
}

export function useUpdateAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "dismissed" | "open" }) => api.updateAlert(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["analytics", "alerts"] })
  });
}

export function useCreateInvestment() {
  const invalidate = useInvalidateInvestments();
  return useMutation({ mutationFn: (input: InvestmentInput) => api.createInvestment(input), onSuccess: invalidate });
}

export function useUpdateInvestment() {
  const invalidate = useInvalidateInvestments();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: Parameters<typeof api.updateInvestment>[1] }) => api.updateInvestment(id, changes),
    onSuccess: invalidate
  });
}

export function useDeleteInvestment() {
  const invalidate = useInvalidateInvestments();
  return useMutation({ mutationFn: (id: string) => api.deleteInvestment(id), onSuccess: invalidate });
}

export function useDeleteHolding() {
  const invalidate = useInvalidateInvestments();
  return useMutation({ mutationFn: (schemeCode: string) => api.deleteHolding(schemeCode), onSuccess: invalidate });
}
