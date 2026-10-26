import { currencyDecimals } from "./format";

// Mirrors the server's amount rules so errors show before submitting.
export function validateAmount(value: string, currency: string): { amount?: number; error?: string } {
  if (!value.trim()) {
    return { error: "Enter an amount." };
  }

  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Amount must be greater than 0." };
  }

  const decimals = currencyDecimals(currency);
  const [, fraction = ""] = value.split(".");

  if (fraction.length > decimals) {
    return { error: decimals === 0 ? `${currency} amounts can't have decimals.` : `Use at most ${decimals} decimal places.` };
  }

  return { amount };
}

export function required(value: string, label: string): string | undefined {
  return value.trim() ? undefined : `${label} is required.`;
}
