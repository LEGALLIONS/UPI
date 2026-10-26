import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  InMemoryAccountStore,
  LAKH,
  SandboxPartner,
  buildUpiIntent,
  planCollection,
  rupees,
  startPayment,
  toRupeeString,
  type CheckoutProviders,
} from '../src/index.ts';

const payer = { id: 'cust_1', name: 'Arun Traders', mobile: '9876543210' };
const payee = {
  id: 'cust_2',
  name: 'Meena Steels',
  account: { accountNumber: '00112233445566', ifsc: 'ICIC0000123', holderName: 'MEENA STEELS' },
};
const returnUrl = 'https://example.com/paid';

describe('startPayment', () => {
  let providers: CheckoutProviders;

  beforeEach(() => {
    const partner = new SandboxPartner({ webhookSecret: 'test-secret' });
    providers = { gateway: partner, virtualAccounts: partner, mandates: partner, accounts: new InMemoryAccountStore() };
  });

  it('creates a UPI request for the planned amount', async () => {
    const plan = planCollection({ amount: rupees(45_000.5) });
    const result = await startPayment({ orderId: 'ord_1', payer, payee, plan, method: 'upi', returnUrl }, providers);
    assert.equal(result.method, 'upi');
    assert.match(result.method === 'upi' ? result.upiIntent : '', /am=45000\.50/);
  });

  it('refuses UPI when the plan ruled it out', async () => {
    const plan = planCollection({ amount: 3 * LAKH });
    await assert.rejects(
      startPayment({ orderId: 'ord_1', payer, payee, plan, method: 'upi', returnUrl }, providers),
      /Over the ₹1,00,000.00 UPI limit/,
    );
  });

  it('sends net banking to a redirect on the bank side', async () => {
    const plan = planCollection({ amount: 3 * LAKH });
    const result = await startPayment({ orderId: 'ord_1', payer, payee, plan, method: 'netbanking', returnUrl }, providers);
    assert.equal(result.method, 'netbanking');
    assert.ok(result.method === 'netbanking' && result.redirectUrl.startsWith('https://'));
  });

  it('gives the same virtual account to a payer and payee every time', async () => {
    const plan = planCollection({ amount: 30 * LAKH });
    const first = await startPayment({ orderId: 'ord_1', payer, payee, plan, method: 'bank_transfer', returnUrl }, providers);
    const second = await startPayment({ orderId: 'ord_2', payer, payee, plan, method: 'bank_transfer', returnUrl }, providers);
    assert.deepEqual(first, second);
    assert.deepEqual(first.method === 'bank_transfer' && first.rails, ['rtgs', 'neft']);
  });

  it('needs a verified account before setting up e-NACH', async () => {
    const plan = planCollection({ amount: 25 * LAKH, recurring: true });
    const start = () => startPayment({ orderId: 'ord_1', payer, payee, plan, method: 'enach', returnUrl }, providers);
    await assert.rejects(start(), /Verify cust_1's bank account/);

    await providers.accounts.saveAccount(payer.id, {
      accountNumber: '50100123456789',
      ifsc: 'HDFC0001234',
      holderName: 'ARUN TRADERS',
    });
    assert.equal((await start()).method, 'enach');
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
    assert.throws(
      () => buildUpiIntent({ payeeVpa: 'not-a-vpa', payeeName: 'X', amount: 100, transactionRef: 'r' }),
      /Not a UPI ID/,
    );
  });
});

describe('toRupeeString', () => {
  it('always has two decimal places', () => {
    assert.equal(toRupeeString(1), '0.01');
    assert.equal(toRupeeString(150), '1.50');
    assert.equal(toRupeeString(LAKH), '100000.00');
  });
});
