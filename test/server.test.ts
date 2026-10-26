import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { MeView, OrderView, PayeeView, PlanView, SessionResponse, UpiPaymentRequest } from '../server/api-types.ts';
import { createApiServer, createSandboxDeps } from '../server/app.ts';
import { CRORE, LAKH, rupees } from '../src/index.ts';

describe('ePay API (sandbox)', () => {
  const deps = createSandboxDeps();
  const server = createApiServer(deps);
  let base = '';

  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  async function call<T = unknown>(method: string, path: string, options: { body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
        ...(options.token && { Authorization: `Bearer ${options.token}` }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
    });
    return { status: response.status, body: (await response.json()) as T };
  }

  async function signIn(mobile: string): Promise<string> {
    const otp = await call<{ devCode: string }>('POST', '/auth/otp', { body: { mobile } });
    assert.equal(otp.status, 200);
    const session = await call<SessionResponse>('POST', '/auth/session', { body: { mobile, code: otp.body.devCode } });
    assert.equal(session.status, 200);
    return session.body.token;
  }

  async function verify(token: string, holderName: string): Promise<MeView> {
    const request = await call<UpiPaymentRequest>('POST', '/me/verification', { token });
    assert.match(request.body.upiIntent, /^upi:\/\/pay\?/);
    const me = await call<MeView>('POST', '/sandbox/penny-drop', { token, body: { requestId: request.body.requestId, holderName } });
    assert.equal(me.status, 200);
    return me.body;
  }

  const pay = (token: string, amount: number) => call<OrderView>('POST', '/payments', { token, body: { payeeId: payee.id, amount } });
  const step = (token: string, id: string, action: string, body?: unknown) =>
    call<OrderView>('POST', `/payments/${id}/${action}`, { token, body: body ?? {} });
  const view = (token: string, id: string) => call<OrderView>('GET', `/payments/${id}`, { token });

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

  it('plans a ₹3 lakh payment: bank transfer only, and a 0.2% fee', async () => {
    const plan = await call<PlanView>('POST', '/payments/plan', { token: payer, body: { payeeId: payee.id, amount: 3 * LAKH } });
    assert.deepEqual(plan.body.options.map((option) => option.method), ['bank_transfer']);
    assert.equal(plan.body.fee, rupees(600));
    assert.equal(plan.body.feePercent, '0.2');
  });

  it('takes the fee first, then sends the money straight to the payee, who confirms it', async () => {
    const created = await pay(payer, 3 * LAKH);
    assert.equal(created.status, 201);
    const order = created.body;
    assert.equal(order.status, 'awaiting_fee');
    assert.match(order.feeRequest?.upiIntent ?? '', /pa=epay%40sandbox.*am=600\.00/);
    assert.equal(order.instructions, null, 'no payee details until the fee is paid');
    assert.equal((await step(payer, order.id, 'sent', { utr: '412345678901' })).status, 409);

    const asPayee = await view(supplier, order.id);
    assert.equal(asPayee.body.role, 'payee');
    assert.equal(asPayee.body.feeRequest, null);
    assert.equal(asPayee.body.payer.name, 'ARUN TRADERS');

    const feePaid = await call<OrderView>('POST', `/sandbox/payments/${order.id}/fee`, { token: payer, body: {} });
    assert.equal(feePaid.body.status, 'awaiting_transfer');
    assert.equal(feePaid.body.instructions?.upiIntent, null, '₹3 lakh is over the UPI limit');
    assert.deepEqual(feePaid.body.instructions?.bankTransfer, {
      accountNumber: '50109000000002',
      ifsc: 'HDFC0001234',
      beneficiaryName: 'MEENA STEELS',
      rails: ['imps', 'rtgs', 'neft'],
    });
    assert.equal((await view(supplier, order.id)).body.instructions, null);

    assert.equal((await step(supplier, order.id, 'sent', { utr: '412345678901' })).status, 403);
    assert.equal((await step(payer, order.id, 'sent', { utr: 'not a ref' })).status, 400);
    const sent = await step(payer, order.id, 'sent', { utr: ' 4123 4567 8901 ' });
    assert.equal(sent.body.status, 'sent');
    assert.equal(sent.body.utr, '412345678901');

    assert.equal((await step(payer, order.id, 'received')).status, 403);
    assert.equal((await step(supplier, order.id, 'not-received')).body.status, 'not_received');
    assert.equal((await step(payer, order.id, 'sent', { utr: 'HDFCR52026102612' })).body.status, 'sent');
    const received = await step(supplier, order.id, 'received');
    assert.equal(received.body.status, 'received');
    assert.equal(received.body.utr, 'HDFCR52026102612');
    assert.equal((await step(supplier, order.id, 'received')).status, 409);
  });

  it("sends UPI straight to the payee's own UPI ID when it fits", async () => {
    const order = (await pay(payer, rupees(50_000))).body;
    const paid = await call<OrderView>('POST', `/sandbox/payments/${order.id}/fee`, { token: payer, body: {} });
    const upi = paid.body.instructions?.upiIntent ?? '';
    assert.match(upi, /^upi:\/\/pay\?pa=9000000002%40sandbox&pn=MEENA%20STEELS&am=50000\.00&cu=INR&tn=EPAY/);
    assert.doesNotMatch(upi, /tr=/);
  });

  it('lets the payer retry a failed fee, and still counts a late payment of the first one', async () => {
    const order = (await pay(payer, LAKH)).body;
    const firstRequest = order.feeRequest!.requestId;
    const failed = await call<OrderView>('POST', `/sandbox/payments/${order.id}/fee`, { token: payer, body: { status: 'failed' } });
    assert.equal(failed.body.status, 'awaiting_fee');
    assert.equal(failed.body.feeFailed, true);

    const retried = await step(payer, order.id, 'fee');
    assert.notEqual(retried.body.feeRequest?.requestId, firstRequest);
    assert.equal(retried.body.feeFailed, false);

    const late = deps.sandbox.partner.simulatePaymentWebhook({ requestId: firstRequest, status: 'success' });
    const hook = await call<{ matched: boolean }>('POST', '/webhooks/payments', { body: late.rawBody, headers: { 'X-Signature': late.signature } });
    assert.equal(hook.body.matched, true);
    assert.equal((await view(payer, order.id)).body.status, 'awaiting_transfer');
  });

  it('rejects webhooks with a bad signature', async () => {
    const signed = deps.sandbox.partner.simulatePaymentWebhook({ requestId: 'fee_1', status: 'success' });
    const response = await call('POST', '/webhooks/payments', {
      body: signed.rawBody.replace('success', 'failed'),
      headers: { 'X-Signature': signed.signature },
    });
    assert.equal(response.status, 400);
  });

  it('refuses amounts whose fee would be over the UPI limit', async () => {
    const response = await call<{ error: string }>('POST', '/payments/plan', { token: payer, body: { payeeId: payee.id, amount: 6 * CRORE } });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /UPI limit/);
  });

  it('needs a verified account to pay', async () => {
    const newcomer = await signIn('9000000003');
    const response = await call('POST', '/payments/plan', { token: newcomer, body: { payeeId: payee.id, amount: LAKH } });
    assert.equal(response.status, 403);
  });

  it('lists payments sent and received, newest first, to the two parties only', async () => {
    const sent = await call<OrderView[]>('GET', '/payments', { token: payer });
    assert.equal(sent.body.length, 3);
    assert.deepEqual(sent.body.map((order) => order.role), ['payer', 'payer', 'payer']);
    assert.deepEqual(sent.body.map((order) => order.amount), [LAKH, rupees(50_000), 3 * LAKH]);
    const received = await call<OrderView[]>('GET', '/payments', { token: supplier });
    assert.deepEqual(received.body.map((order) => order.role), ['payee', 'payee', 'payee']);
    const other = await signIn('9000000004');
    assert.equal((await view(other, sent.body[0]!.id)).status, 404);
  });
});
