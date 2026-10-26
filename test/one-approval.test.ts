import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MeView, OrderView, PayeeView } from '../server/api-types.ts';
import { createSandboxDeps } from '../server/app.ts';
import { LAKH, rupees } from '../src/index.ts';
import { startApi } from './helpers.ts';

describe('one-approval payments through the payer’s bank', () => {
  const deps = createSandboxDeps();
  let api: Awaited<ReturnType<typeof startApi>>;
  let payer = '';
  let supplier = '';
  let payee: PayeeView;

  before(async () => {
    api = await startApi(deps);
    payer = await api.signIn('9000000001');
    await api.verify(payer, 'Arun Traders');
    supplier = await api.signIn('9000000002');
    await api.verify(supplier, 'Meena Steels');
    payee = (await api.call<PayeeView>('GET', '/payees/9000000002', { token: payer })).body;
  });
  after(() => api.close());

  const me = (token: string) => api.call<MeView>('GET', '/me', { token });
  const pay = (amount: number) => api.call<OrderView>('POST', '/payments', { token: payer, body: { payeeId: payee.id, amount } });
  const bankPay = (id: string) => api.call<OrderView>('POST', `/payments/${id}/bank-pay`, { token: payer, body: {} });
  const bank = (id: string, outcome: string) =>
    api.call<OrderView>('POST', `/sandbox/payments/${id}/bank`, { token: payer, body: { outcome } });
  const linkResult = (outcome: string) => api.call<MeView>('POST', '/sandbox/bank-link', { token: payer, body: { outcome } });

  it('links the payer’s current account once they approve ePay in their bank', async () => {
    assert.equal((await me(payer)).body.oneApproval, 'not_linked');
    assert.equal((await me(payer)).body.bankName, 'HDFC Bank');
    const order = (await pay(LAKH)).body;
    assert.equal(order.oneApproval, false);
    assert.equal((await bankPay(order.id)).status, 409);

    const pending = await api.call<MeView>('POST', '/me/bank-link', { token: payer, body: {} });
    assert.equal(pending.body.oneApproval, 'pending');
    assert.equal((await linkResult('decline')).body.oneApproval, 'declined');

    await api.call('POST', '/me/bank-link', { token: payer, body: {} });
    assert.equal((await linkResult('approve')).body.oneApproval, 'linked');
  });

  it('sends both parts with one approval, and confirms them from the bank’s report', async () => {
    const order = (await pay(3 * LAKH)).body;
    assert.equal(order.oneApproval, true);
    const requested = await bankPay(order.id);
    assert.deepEqual(requested.body.bankRequest, { status: 'pending', parts: ['payment', 'commission'], failedParts: [] });
    assert.equal(requested.body.oneApproval, false);
    assert.equal((await bankPay(order.id)).status, 409);
    assert.equal(
      (await api.call('POST', `/payments/${order.id}/sent`, { token: payer, body: { utr: '412345678901' } })).status,
      409,
      'no manual "sent" while the bank is working on it',
    );

    const done = await bank(order.id, 'approve');
    assert.equal(done.body.status, 'sent');
    assert.match(done.body.utr ?? '', /^\d{12}$/);
    assert.equal(done.body.commissionPaid, true);
    assert.deepEqual(done.body.bankRequest, { status: 'done', parts: ['payment', 'commission'], failedParts: [] });
    assert.equal(done.body.oneApproval, false);

    // ePay's own bank then reports the same commission arriving: counted once.
    const commissionUtr = deps.store.getOrder(order.id)!.commissionUtr!;
    const notice = deps.sandbox.partner.simulateCreditWebhook({ amount: rupees(600), utr: commissionUtr, remarks: order.reference });
    const result = await api.call<{ result: string }>('POST', '/webhooks/commission', {
      body: notice.rawBody,
      headers: { 'X-Signature': notice.signature },
    });
    assert.equal(result.body.result, 'duplicate');

    const received = await api.call<OrderView>('POST', `/payments/${order.id}/received`, { token: supplier, body: {} });
    assert.equal(received.body.status, 'received');
  });

  it('leaves a part the bank couldn’t send for the payer to send again', async () => {
    const order = (await pay(LAKH)).body;
    await bankPay(order.id);
    const partial = await bank(order.id, 'commission_fails');
    assert.equal(partial.body.status, 'sent');
    assert.equal(partial.body.commissionPaid, false);
    assert.deepEqual(partial.body.bankRequest?.failedParts, ['commission']);
    assert.equal(partial.body.oneApproval, true);

    const retry = await bankPay(order.id);
    assert.deepEqual(retry.body.bankRequest?.parts, ['commission'], 'the amount already went, so only the commission');
    assert.equal((await bank(order.id, 'approve')).body.commissionPaid, true);
  });

  it('keeps everything open when the payer declines in their bank', async () => {
    const order = (await pay(rupees(20_000))).body;
    await bankPay(order.id);
    const declined = await bank(order.id, 'decline');
    assert.equal(declined.body.status, 'awaiting_transfer');
    assert.equal(declined.body.commissionPaid, false);
    assert.deepEqual(declined.body.bankRequest?.failedParts, ['payment', 'commission']);
    assert.equal(declined.body.oneApproval, true);
  });

  it('rejects bank notices with a bad signature', async () => {
    const signed = deps.sandbox.partner.simulateBankWebhook({ kind: 'link', linkId: 'lnk_1', status: 'approved' });
    const response = await api.call('POST', '/webhooks/bank', {
      body: signed.rawBody.replace('approved', 'declined'),
      headers: { 'X-Signature': signed.signature },
    });
    assert.equal(response.status, 400);
  });
});

describe('a bank ePay has no API agreement with', () => {
  it('offers the two transfers only', async () => {
    const api = await startApi(createSandboxDeps({ connectedBanks: ['ICIC'] }));
    try {
      const token = await api.signIn('9000000005');
      const me = await api.verify(token, 'Ravi Textiles');
      assert.equal(me.oneApproval, 'unsupported');
      const link = await api.call<{ error: string }>('POST', '/me/bank-link', { token, body: {} });
      assert.equal(link.status, 400);
      assert.match(link.body.error, /can't connect to HDFC Bank yet/);
    } finally {
      api.close();
    }
  });
});
