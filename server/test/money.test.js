const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeCurrency,
    getCurrencyDecimals,
    createMoneyRounder,
    parseAmount
} = require('../utils/money');

test('currencies are validated against ISO 4217', () => {
    assert.equal(normalizeCurrency(' usd '), 'USD');
    assert.equal(normalizeCurrency('INR'), 'INR');
    assert.equal(normalizeCurrency('XYZ1'), null);
    assert.equal(normalizeCurrency(''), null);
    assert.equal(normalizeCurrency(null), null);
});

test('rounding follows each currency minor unit', () => {
    assert.equal(getCurrencyDecimals('JPY'), 0);
    assert.equal(getCurrencyDecimals('INR'), 2);
    assert.equal(getCurrencyDecimals('KWD'), 3);
    assert.equal(createMoneyRounder('JPY')(1234.5), 1235);
    assert.equal(createMoneyRounder('USD')(1.005), 1.01);
    assert.equal(createMoneyRounder('USD')(0.1 + 0.2), 0.3);
    assert.equal(createMoneyRounder('USD')(-1.005), -1.01);
    assert.equal(createMoneyRounder('KWD')(1.0005), 1.001);
});

test('amounts must be positive and fit the currency', () => {
    assert.deepEqual(parseAmount(250.5, 'INR'), { amount: 250.5 });
    assert.deepEqual(parseAmount('99.99', 'USD'), { amount: 99.99 });
    assert.ok(parseAmount(0, 'USD').error);
    assert.ok(parseAmount(-5, 'USD').error);
    assert.ok(parseAmount('abc', 'USD').error);
    assert.ok(parseAmount(Infinity, 'USD').error);
    assert.ok(parseAmount(true, 'USD').error);
    assert.ok(parseAmount(10.5, 'JPY').error);
    assert.ok(parseAmount(1.234, 'USD').error);
    assert.deepEqual(parseAmount(1.234, 'KWD'), { amount: 1.234 });
});
