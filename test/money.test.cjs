const test = require('node:test');
const assert = require('node:assert/strict');

const {
  amountFromCents,
  formatMoneyFromCents,
  formatMoneyInputFromCents,
  formatMoneyValue,
  parseMoneyValue,
  parseMoneyToCents,
  resolveAmountCents,
} = require('../src/shared/money.cjs');

test('parseMoneyValue accepts formatted and localized amounts', () => {
  assert.equal(parseMoneyValue('313750.00'), 313750);
  assert.equal(parseMoneyValue('313,750.00'), 313750);
  assert.equal(parseMoneyValue('$313,750.00'), 313750);
  assert.equal(parseMoneyValue('313750,00'), 313750);
  assert.equal(parseMoneyValue('313,750'), 313750);
  assert.equal(parseMoneyValue('1,250.50'), 1250.5);
  assert.equal(parseMoneyValue('0.00'), 0);
});

test('parseMoneyToCents preserves large dollar values', () => {
  assert.equal(parseMoneyToCents('313750.00'), 31375000);
  assert.equal(parseMoneyToCents('313,750.00'), 31375000);
  assert.equal(parseMoneyToCents('$313,750.00'), 31375000);
});

test('resolveAmountCents respects explicit cents over dollar inputs', () => {
  assert.equal(resolveAmountCents(313750, '1.23'), 313750);
  assert.equal(resolveAmountCents('313,750', null), 313750);
  assert.equal(resolveAmountCents(null, '313,750.00'), 31375000);
});

test('invalid money text is rejected', () => {
  assert.equal(parseMoneyValue('abc'), null);
  assert.equal(parseMoneyToCents('12.34.56'), null);
  assert.equal(resolveAmountCents(null, 'USD one hundred'), null);
});

test('shared money formatters render cents and amount values consistently', () => {
  assert.equal(amountFromCents(125050), 1250.5);
  assert.equal(formatMoneyFromCents(125050), '$1,250.50');
  assert.equal(formatMoneyInputFromCents(125050), '1250.50');
  assert.equal(formatMoneyValue(1250.5), '$1,250.50');
});