import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CRORE,
  LAKH,
  buildUpiIntent,
  feeFor,
  feePercent,
  paymentInstructions,
  planCollection,
  rupees,
  toRupeeString,
} from '../src/index.ts';

const payee = {
  id: 'cust_2',
  name: 'MEENA STEELS',
  account: { accountNumber: '00112233445566', ifsc: 'ICIC0000123', holderName: 'MEENA STEELS', vpa: 'meenasteels@okicici' },
};
const orderId = 'ord_9c1d2e3f-0000-4a5b-8c7d-ab12cd34ef56';

describe('paymentInstructions', () => {
  it("sends UPI and bank transfer straight to the payee's own account", () => {
    const plan = planCollection({ amount: rupees(45_000.5) });
    const instructions = paymentInstructions({ orderId, payee, plan });
    assert.equal(instructions.reference, 'EPAYCD34EF56');
    assert.equal(
      instructions.upiIntent,
      'upi://pay?pa=meenasteels%40okicici&pn=MEENA%20STEELS&am=45000.50&cu=INR&tn=EPAYCD34EF56',
    );
    assert.deepEqual(instructions.bankTransfer, {
      accountNumber: '00112233445566',
      ifsc: 'ICIC0000123',
      beneficiaryName: 'MEENA STEELS',
      rails: ['imps', 'neft'],
    });
  });

  it('leaves out UPI above the limit, or when the payee has no UPI ID', () => {
    const big = paymentInstructions({ orderId, payee, plan: planCollection({ amount: 3 * LAKH }) });
    assert.equal(big.upiIntent, null);
    assert.deepEqual(big.bankTransfer.rails, ['imps', 'rtgs', 'neft']);

    const noUpi = { ...payee, account: { ...payee.account, vpa: undefined } };
    assert.equal(paymentInstructions({ orderId, payee: noUpi, plan: planCollection({ amount: LAKH }) }).upiIntent, null);
  });
});

describe('feeFor', () => {
  it('charges 0.2%, rounded to the nearest paisa', () => {
    assert.equal(feePercent(), '0.2');
    assert.equal(feeFor(3 * LAKH), rupees(600));
    assert.equal(feeFor(CRORE), rupees(20_000));
    assert.equal(feeFor(rupees(1_234.56)), 247);
  });

  it('never charges less than ₹1', () => {
    assert.equal(feeFor(rupees(100)), rupees(1));
  });

  it('follows a different rate when given one', () => {
    assert.equal(feeFor(3 * LAKH, { rateBps: 50, minimum: rupees(1) }), rupees(1_500));
  });
});

describe('buildUpiIntent', () => {
  it('encodes spaces as %20, not +', () => {
    const intent = buildUpiIntent({
      payeeVpa: 'arun.traders@okhdfc',
      payeeName: 'Arun Traders',
      amount: rupees(1_500),
      transactionRef: 'ord_1',
      note: 'Invoice 42',
    });
    assert.equal(intent, 'upi://pay?pa=arun.traders%40okhdfc&pn=Arun%20Traders&am=1500.00&cu=INR&tr=ord_1&tn=Invoice%2042');
  });

  it('rejects something that is not a UPI ID', () => {
    assert.throws(() => buildUpiIntent({ payeeVpa: 'not-a-vpa', payeeName: 'X', amount: 100 }), /Not a UPI ID/);
  });
});

describe('toRupeeString', () => {
  it('always has two decimal places', () => {
    assert.equal(toRupeeString(1), '0.01');
    assert.equal(toRupeeString(150), '1.50');
    assert.equal(toRupeeString(LAKH), '100000.00');
  });
});
