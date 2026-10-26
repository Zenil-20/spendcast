// Display formatting. Amounts use the user's currency; calendar dates
// ("YYYY-MM-DD") are formatted without any timezone shift.

const moneyFormats = new Map<string, Intl.NumberFormat>();

// "full" shows the currency's minor units, "whole" rounds to whole units for
// headlines, "compact" abbreviates (₹45K) for chart axes and ranges.
type MoneyStyle = "full" | "whole" | "compact";

function moneyFormat(currency: string, style: MoneyStyle): Intl.NumberFormat {
  const key = `${currency}:${style}`;

  if (!moneyFormats.has(key)) {
    // Rupees use Indian digit grouping (₹1,78,297) and lakh/crore when compact.
    moneyFormats.set(key, new Intl.NumberFormat(currency === "INR" ? "en-IN" : undefined, {
      style: "currency",
      currency,
      notation: style === "compact" ? "compact" : "standard",
      maximumFractionDigits: style === "compact" ? 1 : style === "whole" ? 0 : undefined,
      minimumFractionDigits: style === "whole" ? 0 : undefined
    }));
  }

  return moneyFormats.get(key)!;
}

export function formatMoney(value: number | null | undefined, currency: string, style: MoneyStyle | boolean = "full"): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }

  return moneyFormat(currency, style === true ? "compact" : style === false ? "full" : style).format(value);
}

export function currencySymbol(currency: string): string {
  const part = new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "narrowSymbol" })
    .formatToParts(0)
    .find(item => item.type === "currency");

  return part ? part.value : currency;
}

export function currencyDecimals(currency: string): number {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

function calendarDate(dateString: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatDate(dateString: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(calendarDate(dateString));
}

export function addDays(dateString: string, days: number): string {
  const date = calendarDate(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// "Today", "Yesterday", or a weekday for dates in the last week.
export function relativeDay(dateString: string, today: string): string | null {
  if (dateString === today) return "Today";
  if (dateString === addDays(today, -1)) return "Yesterday";
  if (dateString > addDays(today, -7)) return formatDate(dateString, { weekday: "long" });
  return null;
}

export function ordinal(day: number): string {
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][day % 10] ?? "th";
  return `${day}${suffix}`;
}

export function longDate(timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", timeZone }).format(new Date());
}

// Short form of a timezone for the header, e.g. "IST" or "GMT+5:30".
export function zoneAbbreviation(timeZone: string): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(new Date())
      .find(item => item.type === "timeZoneName");
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

export function formatInstant(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone
  }).format(new Date(iso));
}

// Today's calendar date in the given timezone.
export function todayIn(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts;
}

export function monthRange(year: number, month: number): { from: string; to: string } {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");

  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

export function monthName(year: number, month: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join("") || "?";
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// Best guess at the user's currency from the browser locale's region.
const REGION_CURRENCY: Record<string, string> = {
  IN: "INR", US: "USD", GB: "GBP", CA: "CAD", AU: "AUD", NZ: "NZD", SG: "SGD", JP: "JPY",
  CN: "CNY", AE: "AED", SA: "SAR", ZA: "ZAR", BR: "BRL", MX: "MXN", CH: "CHF", SE: "SEK",
  NO: "NOK", DK: "DKK", PL: "PLN", KR: "KRW", HK: "HKD", ID: "IDR", MY: "MYR", TH: "THB",
  PH: "PHP", PK: "PKR", BD: "BDT", LK: "LKR", NP: "NPR", NG: "NGN", KE: "KES", EG: "EGP",
  DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", IE: "EUR", PT: "EUR", BE: "EUR", AT: "EUR", FI: "EUR", GR: "EUR"
};

export function browserCurrency(): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return (region && REGION_CURRENCY[region]) || "USD";
  } catch {
    return "USD";
  }
}

// Signed percentage from a fraction: 0.1234 -> "+12.34%".
export function formatPercent(value: number | null | undefined, { sign = true, digits = 2 } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  const text = `${Math.abs(value * 100).toFixed(digits)}%`;

  if (!sign || Math.abs(value) < 0.00005) return value < 0 && !sign ? `−${text}` : text;
  return value > 0 ? `+${text}` : `−${text}`;
}

export function formatNav(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

export function formatUnits(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export function formatRatio(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

export function signedMoney(value: number, currency: string, style: "full" | "whole" | "compact" = "whole"): string {
  const text = formatMoney(Math.abs(value), currency, style);
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

// Tone class for a gain or loss.
export function tone(value: number | null | undefined): "up" | "down" | "flat" {
  if (value === null || value === undefined || Math.abs(value) < 1e-9) return "flat";
  return value > 0 ? "up" : "down";
}
