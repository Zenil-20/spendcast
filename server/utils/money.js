// Currency helpers. Each ISO 4217 currency has its own number of decimals
// (JPY 0, INR/USD 2, KWD 3), so rounding and validation depend on the currency.

const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));

function normalizeCurrency(value) {
    if (typeof value !== "string") {
        return null;
    }

    const code = value.trim().toUpperCase();

    return supportedCurrencies.has(code) ? code : null;
}

function getSupportedCurrencies() {
    return [...supportedCurrencies];
}

function getCurrencyDecimals(currency) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency })
        .resolvedOptions()
        .maximumFractionDigits;
}

// Returns a function that rounds amounts to the currency's minor unit.
// toPrecision(15) removes binary noise first, so 1.005 rounds to 1.01.
function createMoneyRounder(currency) {
    const factor = 10 ** getCurrencyDecimals(currency);

    return value => {
        const scaled = Number((Math.abs(value) * factor).toPrecision(15));
        const rounded = Math.round(scaled) / factor;

        return value < 0 ? -rounded : rounded;
    };
}

// Validates a positive amount for `currency`. Returns { amount } or { error }.
function parseAmount(value, currency) {
    const amount = typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : value;

    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        return { error: "Amount must be a number greater than 0." };
    }

    const decimals = getCurrencyDecimals(currency);

    if (createMoneyRounder(currency)(amount) !== amount) {
        return { error: `Amount can have at most ${decimals} decimal places for ${currency}.` };
    }

    return { amount };
}

module.exports = {
    normalizeCurrency,
    getSupportedCurrencies,
    getCurrencyDecimals,
    createMoneyRounder,
    parseAmount
};
