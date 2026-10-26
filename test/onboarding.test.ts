import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { AccountVerification, InMemoryAccountStore, SandboxPartner, maskAccount } from '../src/index.ts';

const account = { accountNumber: '50100123456789', ifsc: 'HDFC0001234', holderName: 'ARUN TRADERS' };

describe('AccountVerification', () => {
  let partner: SandboxPartner;
  let store: InMemoryAccountStore;
  let verification: AccountVerification;

  beforeEach(() => {
    partner = new SandboxPartner({ webhookSecret: 'test-secret' });
    store = new InMemoryAccountStore();
    verification = new AccountVerification(partner, store);
  });

  it('asks for ₹1 by UPI and saves the account it came from', async () => {
    const request = await verification.start('cust_1');
    assert.match(request.upiIntent, /^upi:\/\/pay\?.*am=1\.00/);

    const webhook = partner.simulatePennyDropWebhook(request.requestId, account);
    const outcome = await verification.handleWebhook(webhook.rawBody, webhook.signature);

    assert.deepEqual(outcome, { customerId: 'cust_1', verified: true, account: maskAccount(account) });
    assert.deepEqual(await store.getAccount('cust_1'), account);
  });

  it('handles the same webhook delivered twice', async () => {
    const request = await verification.start('cust_1');
    const webhook = partner.simulatePennyDropWebhook(request.requestId, account);
    await verification.handleWebhook(webhook.rawBody, webhook.signature);
    const again = await verification.handleWebhook(webhook.rawBody, webhook.signature);
    assert.equal(again.verified, true);
  });

  it('rejects a webhook whose body was changed after signing', async () => {
    const request = await verification.start('cust_1');
    const webhook = partner.simulatePennyDropWebhook(request.requestId, account);
    const tampered = webhook.rawBody.replace('50100123456789', '11112222333344');
    await assert.rejects(verification.handleWebhook(tampered, webhook.signature), /signature/);
    assert.equal(await store.getAccount('cust_1'), undefined);
  });

  it('reports a failed verification without saving anything', async () => {
    const request = await verification.start('cust_1');
    const webhook = partner.simulatePennyDropWebhook(request.requestId, { failure: 'Payment not received in time' });
    const outcome = await verification.handleWebhook(webhook.rawBody, webhook.signature);
    assert.deepEqual(outcome, { customerId: 'cust_1', verified: false, reason: 'Payment not received in time' });
    assert.equal(await store.getAccount('cust_1'), undefined);
  });

  it('rejects a webhook for a request it never started', async () => {
    const webhook = partner.simulatePennyDropWebhook('pd_999', account);
    await assert.rejects(verification.handleWebhook(webhook.rawBody, webhook.signature), /pd_999/);
  });
});

describe('maskAccount', () => {
  it('keeps only the last four digits', () => {
    assert.equal(maskAccount(account).maskedAccountNumber, 'XXXXXXXXXX6789');
  });
});
