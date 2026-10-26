const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, nameWords, queryTokens, editDistance, searchCatalogue } = require('../utils/fundSearch');

const entry = (schemeCode, schemeName) => {
    const words = nameWords(schemeName);
    return { schemeCode, schemeName, isinGrowth: 'INF000000000', search: words.join(' '), words };
};

const catalogue = [
    entry(122639, 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth'),
    entry(122640, 'Parag Parikh Flexi Cap Fund - Regular Plan - Growth'),
    entry(118989, 'HDFC Mid Cap Fund - Direct Plan - Growth Option'),
    entry(118778, 'Nippon India Small Cap Fund - Direct Plan - Growth Option'),
    entry(154646, 'Nippon India Income Plus Arbitrage Omni Fund of Fund - Direct Plan - Growth Option'),
    entry(120465, 'Axis Large Cap Fund - Direct Plan - Growth Option'),
    entry(125497, 'SBI SMALL CAP FUND - Direct Plan - Growth')
];

const top = query => searchCatalogue(catalogue, query, { limit: 3 });

test('names and queries normalise "mid cap" / "Mid-Cap" / "midcap" the same way', () => {
    assert.equal(normalize('HDFC Mid-Cap Fund'), 'hdfc midcap fund');
    assert.equal(normalize('HDFC Mid Cap Fund'), 'hdfc midcap fund');
    assert.equal(normalize('Large & Mid Cap'), 'large and midcap');
});

test('filler words are ignored and short forms expanded', () => {
    assert.deepEqual(queryTokens('Nippon MF fund'), ['nippon']);
    assert.deepEqual(queryTokens('ppfas'), ['parag', 'parikh']);
});

test('edit distance gives up past the limit', () => {
    assert.equal(editDistance('nipon', 'nippon', 1), 1);
    assert.equal(editDistance('nipon', 'mirae', 1), 2);
});

test('"nippon mf" finds Nippon funds instead of nothing', () => {
    const result = top('nippon mf');
    assert.equal(result.match, 'exact');
    // Mainstream fund ranks above the fund of funds.
    assert.equal(result.results[0].schemeCode, 118778);
});

test('typos are corrected', () => {
    assert.equal(top('nipon small cap').results[0].schemeCode, 118778);
    assert.equal(top('nipon small cap').match, 'fuzzy');
    assert.equal(top('parikhh flexi').results[0].schemeCode, 122639);
    assert.equal(top('sbi smal cap').results[0].schemeCode, 125497);
});

test('aliases and joined words', () => {
    assert.equal(top('ppfas flexi').results[0].schemeCode, 122639);
    assert.equal(top('hdfc midcap').results[0].schemeCode, 118989);
});

test('direct plans rank first, and a word that cannot match gives partial results', () => {
    assert.equal(top('parag parikh').results[0].schemeCode, 122639);
    const partial = top('axis large cap xyzzy');
    assert.equal(partial.match, 'partial');
    assert.equal(partial.results[0].schemeCode, 120465);
    assert.equal(top('zzzz qqqq').match, 'none');
});
