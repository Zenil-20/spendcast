// Loads fund holdings and expense ratios for the overlap detector and the
// health score. NAV data has no holdings, so they come from the monthly
// portfolio disclosures AMCs publish (and expense ratios from AMFI), turned
// into this JSON format:
//
//   [
//     {
//       "schemeCodes": [122639, 122640],      every plan of the scheme
//       "asOf": "2026-09-30",                 disclosure date
//       "expenseRatio": 0.63,                 optional; percent or fraction
//       "holdings": [
//         { "isin": "INE040A01034", "name": "HDFC Bank Ltd", "sector": "Financial Services",
//           "assetType": "equity", "weight": 7.9 },
//         { "name": "TREPS", "assetType": "cash", "weight": 4.1 }
//       ]
//     }
//   ]
//
// Weights are percentages or fractions of the fund (detected per entry).
// assetType is equity, debt, cash or other (default equity). A holding without
// an ISIN is matched across funds by its name. Entries that fail validation
// are listed and skipped; the rest are stored. Re-running with the same asOf
// replaces that disclosure.
//
// Usage:
//   node scripts/import-fund-portfolios.js <file.json> [--source "AMC disclosure Sep 2026"]

require('dotenv').config();

const fs = require('fs');
const mongoose = require('mongoose');
const { importPortfolios } = require('../services/fundPortfolios');

function readArg(name) {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
    const file = process.argv[2];
    if (!file || file.startsWith('--')) {
        console.error('Usage: node scripts/import-fund-portfolios.js <file.json> [--source "label"]');
        process.exitCode = 1;
        return;
    }

    const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(entries)) throw new Error('The file must contain a JSON list of disclosures.');

    await mongoose.connect(process.env.MONGO_URI);
    try {
        const report = await importPortfolios(entries, readArg('source') || `import:${new Date().toISOString().slice(0, 10)}`);
        console.log(`Stored ${report.stored} scheme disclosures.`);
        for (const item of report.rejected) {
            console.log(`  Skipped entry ${item.index} (${JSON.stringify(item.schemeCodes)}): ${item.error}`);
        }
        if (report.rejected.length) process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
}

main().catch(error => {
    console.error('Import failed:', error.message);
    process.exitCode = 1;
});
