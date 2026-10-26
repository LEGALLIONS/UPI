import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_LIMITS, LAKH, CRORE, planCollection, planPayout, rupees } from '../src/index.ts';

const methods = (amount: number, extra = {}) => planCollection({ amount, ...extra }).options.map((option) => option.method);

describe('planCollection', () => {
  it('offers UPI first while the amount is within the ₹1 lakh limit', () => {
    assert.deepEqual(methods(rupees(50_000)), ['upi', 'netbanking', 'bank_transfer']);
    assert.deepEqual(methods(LAKH), ['upi', 'netbanking', 'bank_transfer']);
  });

  it('drops UPI one paisa over the limit and says why', () => {
    const plan = planCollection({ amount: LAKH + 1 });
    assert.deepEqual(plan.options.map((option) => option.method), ['netbanking', 'bank_transfer']);
    assert.deepEqual(plan.unavailable, [{ method: 'upi', reason: 'Over the ₹1,00,000.00 UPI limit per payment' }]);
  });

  it('applies higher limits for a verified merchant category', () => {
    assert.equal(methods(3 * LAKH)[0], 'netbanking');
    assert.equal(methods(3 * LAKH, { merchantCategory: 'business_payments' })[0], 'upi');
    assert.equal(methods(3 * LAKH, { merchantCategory: 'jewellery' })[0], 'netbanking');
  });

  it('counts what the payer already paid by UPI today against the daily limit', () => {
    const plan = planCollection({ amount: 4 * LAKH, merchantCategory: 'insurance', upiPaidToday: 7 * LAKH });
    assert.deepEqual(plan.unavailable, [{ method: 'upi', reason: 'Would go over the ₹10,00,000.00 UPI daily limit' }]);
    assert.equal(methods(4 * LAKH, { merchantCategory: 'insurance', upiPaidToday: 6 * LAKH })[0], 'upi');
  });

  it('has no category daily cap for business payments', () => {
    assert.equal(methods(5 * LAKH, { merchantCategory: 'business_payments', upiPaidToday: 50 * LAKH })[0], 'upi');
  });

  it('puts e-NACH first for recurring payments, up to ₹1 crore', () => {
    assert.deepEqual(methods(25 * LAKH, { recurring: true }), ['enach', 'netbanking', 'bank_transfer']);
    const tooBig = planCollection({ amount: 2 * CRORE, recurring: true });
    assert.equal(tooBig.options[0]?.method, 'netbanking');
    assert.equal(tooBig.unavailable[0]?.method, 'enach');
  });

  it('lists the transfer rails that fit the amount', () => {
    const rails = (amount: number) => planCollection({ amount }).options.find((option) => option.rails)?.rails;
    assert.deepEqual(rails(LAKH), ['imps', 'neft']);
    assert.deepEqual(rails(3 * LAKH), ['imps', 'rtgs', 'neft']);
    assert.deepEqual(rails(10 * LAKH), ['rtgs', 'neft']);
  });

  it("uses the payer bank's own lower limit when given one", () => {
    const limits = { ...DEFAULT_LIMITS, upiDefault: { perTxn: rupees(25_000), perDay: rupees(25_000) } };
    assert.equal(planCollection({ amount: rupees(30_000) }, limits).options[0]?.method, 'netbanking');
  });

  it('rejects amounts that are not a positive whole number of paise', () => {
    for (const amount of [0, -100, 10.5, Number.NaN]) {
      assert.throws(() => planCollection({ amount }), RangeError);
    }
  });
});

describe('planPayout', () => {
  const rails = (amount: number, urgent: boolean) => planPayout({ amount, urgent }).map((option) => option.rail);

  it('prefers real-time rails when urgent', () => {
    assert.deepEqual(rails(LAKH, true), ['imps', 'neft']);
    assert.deepEqual(rails(3 * LAKH, true), ['imps', 'rtgs', 'neft']);
    assert.deepEqual(rails(12 * LAKH, true), ['rtgs', 'neft']);
  });

  it('prefers NEFT otherwise', () => {
    assert.deepEqual(rails(12 * LAKH, false), ['neft', 'rtgs']);
  });
});
