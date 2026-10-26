// Forgiving fund-name search: ignores filler words ("mf", "fund", "plan"),
// expands common short forms ("ppfas"), treats "mid cap" and "midcap" alike,
// and tolerates small typos ("nipon", "parikhh"). Pure functions, no I/O.

// Words people type that don't help find a fund.
const NOISE_WORDS = new Set(["mf", "mutual", "fund", "funds", "scheme", "plan", "option", "the", "of", "a", "an", "and"]);

// Short forms and brand names people use for fund houses and categories.
const ALIASES = {
    ppfas: "parag parikh",
    ppfcf: "parag parikh flexi cap",
    absl: "aditya birla sun life",
    abslmf: "aditya birla sun life",
    birla: "aditya birla",
    icicipru: "icici prudential",
    pru: "prudential",
    kotakmf: "kotak",
    hdfcmf: "hdfc",
    sbimf: "sbi",
    elss: "elss tax saver",
    taxsaver: "tax saver",
    bluechip: "bluechip large cap",
    nifty50: "nifty 50",
    niftynext50: "nifty next 50"
};

// "Mid Cap", "Mid-Cap" and "Midcap" (and "Blue Chip"/"Bluechip") are written
// several ways in scheme names, so "<word> cap" and "<word> chip" are joined on
// both sides. A misspelt "smal cap" becomes "smalcap", one typo from "smallcap".
const JOINED_WORDS = /\b([a-z]+)\s+(cap|chip)\b/g;

function normalize(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(JOINED_WORDS, "$1$2")
        .replace(/\s+/g, " ")
        .trim();
}

// Words of a scheme name, prepared once per catalogue entry.
function nameWords(schemeName) {
    return normalize(schemeName).split(" ").filter(Boolean);
}

function queryTokens(query) {
    const expanded = normalize(query)
        .split(" ")
        .flatMap(word => (ALIASES[word] ? normalize(ALIASES[word]).split(" ") : [word]));

    return [...new Set(expanded.filter(word => word && !NOISE_WORDS.has(word)))];
}

// Levenshtein distance, giving up once it exceeds `max`.
function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;

    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        let rowMin = i;

        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
            rowMin = Math.min(rowMin, current[j]);
        }

        if (rowMin > max) return max + 1;
        previous = current;
    }

    return previous[b.length];
}

function typoTolerance(token) {
    if (token.length <= 3) return 0;
    if (token.length <= 7) return 1;
    return 2;
}

// How well one query token matches a name: 3 exact word, 2.5 start of a
// word, 1.5 close spelling, 0 no match. Typos are only tried when the first
// letter matches, which keeps the search fast and avoids silly matches.
function tokenMatch(token, words) {
    let best = 0;
    const tolerance = typoTolerance(token);

    for (const word of words) {
        if (word === token) return 3;
        if (token.length >= 2 && word.startsWith(token)) best = Math.max(best, 2.5);
        else if (tolerance && word[0] === token[0] && best < 1.5) {
            if (editDistance(token, word, tolerance) <= tolerance
                || (word.length > token.length && editDistance(token, word.slice(0, token.length), tolerance) <= tolerance)) {
                best = 1.5;
            }
        }
    }

    return best;
}

// Preference among equally good name matches: direct, growth, current schemes.
function preference(entry, held) {
    const text = entry.search;
    let score = 0;
    if (/\bdirect\b/.test(text)) score += 1.5;
    if (/\bgrowth\b/.test(text)) score += 1;
    if (entry.isinGrowth) score += 1;
    if (/\b(idcw|dividend|bonus)\b/.test(text)) score -= 0.5;
    // Specialist products rank below mainstream funds with similar names.
    if (/\b(fof|fund of funds?|fmp|fixed maturity|interval|crisil ibx|series \d+|\d+ days)\b/.test(text)) score -= 1.5;
    if (held && held.has(entry.schemeCode)) score += 2;
    // Newer schemes (codes above ~118000 are post-2013 direct plans) are more likely live.
    score += Math.min(entry.schemeCode, 160000) / 160000;
    return score;
}

// Searches catalogue entries ({ schemeCode, schemeName, search, words }).
// Returns { results, match }: "exact" when every word matched as typed,
// "fuzzy" when spelling was corrected, "partial" when only some words matched.
function searchCatalogue(entries, query, { limit = 25, held = null } = {}) {
    const tokens = queryTokens(query);
    if (!tokens.length) return { results: [], match: "none", tokens };

    const full = [];
    const partial = [];
    const needed = Math.max(1, Math.ceil(tokens.length * 0.6));

    for (const entry of entries) {
        let matched = 0;
        let quality = 0;
        let fuzzy = false;

        for (const token of tokens) {
            const score = tokenMatch(token, entry.words);
            if (score > 0) {
                matched += 1;
                quality += score;
                if (score < 2.5) fuzzy = true;
            }
        }

        if (matched === 0) continue;

        const phrase = tokens.length > 1 && ` ${entry.search} `.includes(` ${tokens.join(" ")} `) ? 4 : 0;
        const startsWell = entry.words[0] && tokenMatch(tokens[0], [entry.words[0]]) >= 2.5 ? 1 : 0;
        const result = { entry, matched, fuzzy, score: quality + phrase + startsWell + preference(entry, held) };

        if (matched === tokens.length) full.push(result);
        else if (matched >= needed) partial.push(result);
    }

    const byScore = (a, b) => b.score - a.score || a.entry.schemeName.length - b.entry.schemeName.length;

    if (full.length) {
        full.sort(byScore);
        const top = full.slice(0, limit);
        return { results: top.map(item => item.entry), match: top.some(item => item.fuzzy) && !full.some(item => !item.fuzzy) ? "fuzzy" : "exact", tokens };
    }

    partial.sort((a, b) => b.matched - a.matched || byScore(a, b));
    return { results: partial.slice(0, limit).map(item => item.entry), match: partial.length ? "partial" : "none", tokens };
}

module.exports = {
    normalize,
    nameWords,
    queryTokens,
    editDistance,
    tokenMatch,
    searchCatalogue
};
