import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { MeView, OrderView, PayeeView, SessionResponse, UpiPaymentRequest } from '../server/api-types.ts';
import { createApiServer, createSandboxDeps } from '../server/app.ts';
import { LAKH, type CollectionPlan } from '../src/index.ts';

const RETURN_URL = 'ipay://payment-return';

describe('iPay API (sandbox)', () => {
  const deps = createSandboxDeps({ publicUrl: 'http://localhost' });
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
      redirect: 'manual',
      headers: {
        ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
        ...(options.token && { Authorization: `Bearer ${options.token}` }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
    });
    const text = await response.text();
    const isJson = response.headers.get('content-type')?.includes('json');
    return { status: response.status, body: (isJson ? JSON.parse(text) : text) as T, headers: response.headers };
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

  let payer = '';
  let payee: PayeeView;

  it('signs in with mobile number and OTP', async () => {
    assert.equal((await call('POST', '/auth/otp', { body: { mobile: '12345' } })).status, 400);
    await call('POST', '/auth/otp', { body: { mobile: '+91 98765 43210' } });
    const wrong = await call('POST', '/auth/session', { body: { mobile: '9876543210', code: '000000x' } });
    assert.equal(wrong.status, 401);
    assert.equal((await call('POST', '/auth/otp', { body: { mobile: '9876543210' } })).status, 429);
  });

  it('verifies the bank account with a ₹1 UPI payment', async () => {
    payer = await signIn('9000000001');
    const before = await call<MeView>('GET', '/me', { token: payer });
    assert.equal(before.body.account, null);
    const me = await verify(payer, 'Arun Traders');
    assert.deepEqual(me.account, { maskedAccountNumber: 'XXXXXXXXXX0001', ifsc: 'HDFC0001234', holderName: 'ARUN TRADERS' });
  });

  it('finds a verified payee by mobile number, and nobody else', async () => {
    const supplier = await signIn('9000000002');
    const notYet = await call('GET', '/payees/9000000002', { token: payer });
    assert.equal(notYet.status, 404);
    await verify(supplier, 'Meena Steels');
    const found = await call<PayeeView>('GET', '/payees/+919000000002', { token: payer });
    assert.equal(found.status, 200);
    assert.equal(found.body.name, 'MEENA STEELS');
    assert.equal(found.body.maskedAccountNumber, 'XXXXXXXXXX0002');
    payee = found.body;
    assert.equal((await call('GET', '/payees/9000000001', { token: payer })).status, 400);
    assert.equal((await call('GET', '/payees/9000000002')).status, 401);
  });

  it('plans a ₹3 lakh payment without UPI', async () => {
    const plan = await call<CollectionPlan>('POST', '/payments/plan', { token: payer, body: { payeeId: payee.id, amount: 3 * LAKH } });
    assert.deepEqual(plan.body.options.map((option) => option.method), ['netbanking', 'bank_transfer']);
    const refused = await call('POST', '/payments', {
      token: payer,
      body: { payeeId: payee.id, amount: 3 * LAKH, method: 'upi', returnUrl: RETURN_URL },
    });
    assert.equal(refused.status, 400);
  });

  it('pays by net banking through the bank page and back to the app', async () => {
    const created = await call<OrderView>('POST', '/payments', {
      token: payer,
      body: { payeeId: payee.id, amount: 3 * LAKH, method: 'netbanking', returnUrl: RETURN_URL },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'pending');
    const { instruction } = created.body;
    assert.equal(instruction.method, 'netbanking');
    if (instruction.method !== 'netbanking') return;

    const bankPath = new URL(instruction.redirectUrl).pathname;
    const page = await call<string>('GET', bankPath);
    assert.match(page.body, /₹3,00,000\.00/);
    assert.match(page.body, /MEENA STEELS/);

    const approved = await call('POST', bankPath, {
      body: 'decision=approve',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    assert.equal(approved.status, 303);
    assert.equal(approved.headers.get('location'), RETURN_URL);
    const after = await call<OrderView>('GET', `/payments/${created.body.id}`, { token: payer });
    assert.equal(after.body.status, 'completed');
  });

  it('matches a bank transfer by account and exact amount, once', async () => {
    const created = await call<OrderView>('POST', '/payments', {
      token: payer,
      body: { payeeId: payee.id, amount: 30 * LAKH, method: 'bank_transfer', returnUrl: RETURN_URL },
    });
    const { instruction } = created.body;
    if (instruction.method !== 'bank_transfer') return assert.fail('expected bank transfer');
    assert.deepEqual(instruction.rails, ['rtgs', 'neft']);

    const webhook = (amount: number, utr: string) =>
      deps.sandbox.partner.simulatePaymentWebhook({ kind: 'transfer', virtualAccountNumber: instruction.accountNumber, amount, utr });
    const post = (signed: { rawBody: string; signature: string }) =>
      call<{ matched: boolean }>('POST', '/webhooks/payments', { body: signed.rawBody, headers: { 'X-Signature': signed.signature } });

    assert.equal((await post(webhook(29 * LAKH, 'UTR1'))).body.matched, false);
    assert.equal((await call<OrderView>('GET', `/payments/${created.body.id}`, { token: payer })).body.status, 'pending');

    const right = webhook(30 * LAKH, 'UTR2');
    assert.equal((await post(right)).body.matched, true);
    const paid = await call<OrderView>('GET', `/payments/${created.body.id}`, { token: payer });
    assert.equal(paid.body.status, 'completed');
    assert.equal(paid.body.utr, 'UTR2');

    // Same transfer reported again must not pay a second open order.
    const second = await call<OrderView>('POST', '/payments', {
      token: payer,
      body: { payeeId: payee.id, amount: 30 * LAKH, method: 'bank_transfer', returnUrl: RETURN_URL },
    });
    await post(right);
    assert.equal((await call<OrderView>('GET', `/payments/${second.body.id}`, { token: payer })).body.status, 'pending');
  });

  it('rejects webhooks with a bad signature', async () => {
    const signed = deps.sandbox.partner.simulatePaymentWebhook({ kind: 'order', requestId: 'nb_1', status: 'success' });
    const response = await call('POST', '/webhooks/payments', {
      body: signed.rawBody.replace('success', 'failed'),
      headers: { 'X-Signature': signed.signature },
    });
    assert.equal(response.status, 400);
  });

  it('refuses a return link that leaves the app', async () => {
    const response = await call<{ error: string }>('POST', '/payments', {
      token: payer,
      body: { payeeId: payee.id, amount: 3 * LAKH, method: 'netbanking', returnUrl: 'https://evil.example/' },
    });
    assert.equal(response.status, 400);
  });

  it('needs a verified account to pay', async () => {
    const newcomer = await signIn('9000000003');
    const response = await call('POST', '/payments/plan', { token: newcomer, body: { payeeId: payee.id, amount: LAKH } });
    assert.equal(response.status, 403);
  });

  it('lists only your own payments, newest first', async () => {
    const list = await call<OrderView[]>('GET', '/payments', { token: payer });
    assert.equal(list.body.length, 3);
    assert.deepEqual(list.body.map((order) => order.method), ['bank_transfer', 'bank_transfer', 'netbanking']);
    const other = await signIn('9000000004');
    assert.equal((await call(`GET`, `/payments/${list.body[0]?.id}`, { token: other })).status, 404);
  });
});
