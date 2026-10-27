import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AdminComplaintView, MeView, OrderView, PayeeView, PlanView } from '../server/api-types.ts';
import { createSandboxDeps } from '../server/app.ts';
import { CRORE, LAKH, rupees } from '../src/index.ts';
import { startApi } from './helpers.ts';

describe('ePay API (sandbox)', () => {
  const deps = createSandboxDeps({ adminToken: 'staff-key' });
  let api: Awaited<ReturnType<typeof startApi>>;
  const call: typeof api.call = (...args) => api.call(...args);
  const signIn = (mobile: string) => api.signIn(mobile);
  const verify = (token: string, holderName: string) => api.verify(token, holderName);

  before(async () => {
    api = await startApi(deps);
  });
  after(() => api.close());

  const pay = (token: string, amount: number) => call<OrderView>('POST', '/payments', { token, body: { payeeId: payee.id, amount } });
  const step = (token: string, id: string, action: string, body?: unknown) =>
    call<OrderView>('POST', `/payments/${id}/${action}`, { token, body: body ?? {} });
  const view = (token: string, id: string) => call<OrderView>('GET', `/payments/${id}`, { token });
  const payCommission = (token: string, id: string) => call<OrderView>('POST', `/sandbox/payments/${id}/commission`, { token, body: {} });
  const credit = (amount: number, utr: string, remarks: string) => {
    const signed = deps.sandbox.partner.simulateCreditWebhook({ amount, utr, remarks });
    return call<{ result: string }>('POST', '/webhooks/commission', { body: signed.rawBody, headers: { 'X-Signature': signed.signature } });
  };

  let payer = '';
  let supplier = '';
  let payee: PayeeView;

  it('signs in with mobile number and OTP', async () => {
    assert.equal((await call('POST', '/auth/otp', { body: { mobile: '12345' } })).status, 400);
    await call('POST', '/auth/otp', { body: { mobile: '+91 98765 43210' } });
    const wrong = await call('POST', '/auth/session', { body: { mobile: '9876543210', code: '000000x' } });
    assert.equal(wrong.status, 401);
    assert.equal((await call('POST', '/auth/otp', { body: { mobile: '9876543210' } })).status, 429);
  });

  it('verifies the bank account and UPI ID with a ₹1 UPI payment', async () => {
    payer = await signIn('9000000001');
    assert.equal((await call<MeView>('GET', '/me', { token: payer })).body.account, null);
    const me = await verify(payer, 'Arun Traders');
    assert.deepEqual(me.account, { maskedAccountNumber: 'XXXXXXXXXX0001', ifsc: 'HDFC0001234', holderName: 'ARUN TRADERS' });
    assert.equal(me.upiId, '9000000001@sandbox');
  });

  it('finds a verified payee by mobile number, and nobody else', async () => {
    supplier = await signIn('9000000002');
    assert.equal((await call('GET', '/payees/9000000002', { token: payer })).status, 404);
    await verify(supplier, 'Meena Steels');
    const found = await call<PayeeView>('GET', '/payees/+919000000002', { token: payer });
    assert.equal(found.status, 200);
    assert.deepEqual(found.body, { id: found.body.id, name: 'MEENA STEELS', maskedAccountNumber: 'XXXXXXXXXX0002', ifsc: 'HDFC0001234' });
    payee = found.body;
    assert.equal((await call('GET', '/payees/9000000001', { token: payer })).status, 400);
    assert.equal((await call('GET', '/payees/9000000002')).status, 401);
  });

  it('plans a ₹3 lakh payment: bank transfer only, plus a 0.2% commission including GST', async () => {
    const plan = await call<PlanView>('POST', '/payments/plan', { token: payer, body: { payeeId: payee.id, amount: 3 * LAKH } });
    assert.deepEqual(plan.body.options.map((option) => option.method), ['bank_transfer']);
    assert.equal(plan.body.fee, rupees(600));
    assert.equal(plan.body.feePercent, '0.2');
    assert.equal(plan.body.gstIncluded, true);
  });

  it('takes the amount first, then the commission; the next payment waits on the commission; the payee confirms', async () => {
    const created = await pay(payer, 3 * LAKH);
    assert.equal(created.status, 201);
    const order = created.body;
    assert.equal(order.status, 'awaiting_transfer');
    assert.equal(order.commissionPaid, false);
    const { instructions } = order;
    assert.ok(instructions);
    assert.equal(instructions.payment.upiIntent, null, '₹3 lakh is over the UPI limit');
    assert.deepEqual(instructions.payment.bankTransfer, {
      accountNumber: '50109000000002',
      ifsc: 'HDFC0001234',
      beneficiaryName: 'MEENA STEELS',
      rails: ['imps', 'rtgs', 'neft'],
    });
    assert.deepEqual(
      instructions.commission,
      {
        amount: rupees(600),
        upiIntent: `upi://pay?pa=epay%40sandbox&pn=EPAY%20TECHNOLOGIES&am=600.00&cu=INR&tr=${order.reference}&tn=${order.reference}`,
      },
      "only the amount and a UPI link: ePay's account details stay on the server",
    );
    assert.doesNotMatch(JSON.stringify(created.body), /777705550001|SBXN0000001/);

    const asPayee = await view(supplier, order.id);
    assert.equal(asPayee.body.role, 'payee');
    assert.equal(asPayee.body.instructions, null);
    assert.equal(asPayee.body.commissionPaid, null);
    assert.equal(asPayee.body.reference, order.reference);
    assert.equal(asPayee.body.payer.name, 'ARUN TRADERS');
    assert.equal(asPayee.body.complaint, null);

    // No bank reference to type and no confirmation from the payee: once the payer has sent it, the commission is due.
    assert.equal((await step(supplier, order.id, 'sent')).status, 403);
    assert.equal((await step(payer, order.id, 'sent')).body.status, 'sent');
    assert.equal((await step(payer, order.id, 'sent')).status, 409);

    const blocked = await call<{ error: string }>('POST', '/payments', { token: payer, body: { payeeId: payee.id, amount: LAKH } });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, new RegExp(`₹600\\.00 commission for your payment ${order.reference}`));

    assert.equal((await payCommission(payer, order.id)).body.commissionPaid, true);
    assert.deepEqual(deps.store.unpaidCommissions(deps.store.getUserByMobile('9000000001')!.id), []);
    assert.equal((await step(payer, order.id, 'complaint', { note: 'paid already' })).status, 409);
  });

  it("sends UPI straight to the payee's own UPI ID when it fits; a commission that arrives early still counts", async () => {
    const order = (await pay(payer, rupees(50_000))).body;
    const upi = order.instructions?.payment.upiIntent ?? '';
    assert.match(upi, /^upi:\/\/pay\?pa=9000000002%40sandbox&pn=MEENA%20STEELS&am=50000\.00&cu=INR&tn=EPAY/);
    assert.doesNotMatch(upi, /tr=/);
    const paid = await payCommission(payer, order.id);
    assert.equal(paid.body.commissionPaid, true);
    assert.equal(paid.body.status, 'awaiting_transfer');
  });

  it('matches credits to ePay by the reference in the remarks, once, and only for the full commission', async () => {
    const order = (await pay(payer, LAKH)).body;
    await step(payer, order.id, 'sent');

    const [prefix, code] = [order.reference.slice(0, 4), order.reference.slice(4)];
    assert.equal((await credit(rupees(200), 'UTR000000001', 'no reference here')).body.result, 'unmatched');
    assert.equal((await credit(rupees(199), 'UTR000000002', order.reference)).body.result, 'unmatched');
    assert.equal((await view(payer, order.id)).body.commissionPaid, false);

    const messy = `Commission ${prefix.toLowerCase()} ${code.slice(0, 4)} ${code.slice(4)}`;
    assert.equal((await credit(rupees(200), 'UTR000000003', messy)).body.result, 'matched');
    assert.equal((await credit(rupees(200), 'UTR000000003', messy)).body.result, 'duplicate');
    assert.equal((await view(payer, order.id)).body.commissionPaid, true);
  });

  it('rejects credit notices with a bad signature', async () => {
    const signed = deps.sandbox.partner.simulateCreditWebhook({ amount: rupees(600), utr: 'UTR1', remarks: 'EPAY00000000' });
    const response = await call('POST', '/webhooks/commission', {
      body: signed.rawBody.replace('600', '6000'),
      headers: { 'X-Signature': signed.signature },
    });
    assert.equal(response.status, 400);
  });

  it('takes the commission on very large amounts by bank transfer', async () => {
    const plan = await call<PlanView>('POST', '/payments/plan', { token: payer, body: { payeeId: payee.id, amount: 6 * CRORE } });
    assert.equal(plan.status, 200);
    assert.equal(plan.body.fee, rupees(1_20_000));
  });

  it('needs a verified account to pay', async () => {
    const newcomer = await signIn('9000000003');
    const response = await call('POST', '/payments/plan', { token: newcomer, body: { payeeId: payee.id, amount: LAKH } });
    assert.equal(response.status, 403);
  });

  it('lists payments sent and received, newest first, to the two parties only', async () => {
    const sent = await call<OrderView[]>('GET', '/payments', { token: payer });
    assert.deepEqual(sent.body.map((order) => order.amount), [LAKH, rupees(50_000), 3 * LAKH]);
    assert.deepEqual(sent.body.map((order) => order.role), ['payer', 'payer', 'payer']);
    const received = await call<OrderView[]>('GET', '/payments', { token: supplier });
    assert.deepEqual(received.body.map((order) => order.role), ['payee', 'payee', 'payee']);
    const other = await signIn('9000000004');
    assert.equal((await view(other, sent.body[0]!.id)).status, 404);
  });

  it('waives the commission after a complaint, once ePay staff have checked', async () => {
    const admin = <T>(method: string, path: string, body?: unknown, token = 'staff-key') => call<T>(method, path, { token, body });
    const order = (await pay(payer, rupees(80_000))).body;
    assert.equal((await step(payer, order.id, 'complaint')).status, 409, 'not sent yet');
    await step(payer, order.id, 'sent');
    assert.equal((await step(supplier, order.id, 'complaint')).status, 403);
    const raised = await step(payer, order.id, 'complaint', { note: ' My bank says it failed ' });
    assert.deepEqual(raised.body.complaint, { note: 'My bank says it failed', status: 'open' });
    assert.equal((await step(payer, order.id, 'complaint')).status, 409, 'one complaint per payment');
    assert.equal((await pay(payer, LAKH)).status, 409, 'the commission stays due while ePay checks');

    assert.equal((await admin('GET', '/admin/complaints', undefined, 'wrong-key')).status, 401);
    const open = await admin<AdminComplaintView[]>('GET', '/admin/complaints');
    assert.deepEqual(open.body.map((complaint) => complaint.reference), [order.reference]);
    assert.equal(open.body[0]!.payer.accountNumber, '50109000000001');
    assert.equal(open.body[0]!.payee.mobile, '9000000002');
    assert.equal((await admin('POST', `/admin/payments/${order.id}/complaint`, { outcome: 'waive' })).status, 200);
    assert.equal((await view(payer, order.id)).body.complaint?.status, 'waived');
    assert.deepEqual((await admin('GET', '/admin/complaints')).body, []);
    assert.equal((await admin('POST', `/admin/payments/${order.id}/complaint`, { outcome: 'reject' })).status, 409);

    // Waived, so the next payment can go. A rejected complaint leaves its commission due.
    const next = await pay(payer, LAKH);
    assert.equal(next.status, 201);
    await step(payer, next.body.id, 'sent');
    await step(payer, next.body.id, 'complaint');
    const reviewed = await call<OrderView>('POST', `/sandbox/payments/${next.body.id}/complaint-review`, {
      token: payer,
      body: { outcome: 'reject' },
    });
    assert.equal(reviewed.body.complaint?.status, 'rejected');
    assert.equal((await pay(payer, LAKH)).status, 409);
  });
});
