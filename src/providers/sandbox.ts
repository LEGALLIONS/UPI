import { createHmac, timingSafeEqual } from 'node:crypto';
import type { VerifiedAccountStore } from '../onboarding.ts';
import { rupees } from '../money.ts';
import { buildUpiIntent } from '../upi-intent.ts';
import type {
  Customer,
  MandateProvider,
  PaymentGateway,
  PayoutProvider,
  PennyDropResult,
  ReversePennyDropProvider,
  UpiPaymentRequest,
  VerifiedBankAccount,
  VirtualAccount,
  VirtualAccountProvider,
} from './types.ts';

// In-memory stand-ins for a partner's APIs, for tests and local development.
// Nothing here moves money. Replace with real adapters before going live.

const SANDBOX_IFSC = 'SBXN0000001';
const REQUEST_TTL_MS = 10 * 60 * 1000;

export interface SandboxOptions {
  webhookSecret: string;
  merchantVpa?: string;
  merchantName?: string;
}

export class SandboxPartner
  implements ReversePennyDropProvider, PaymentGateway, VirtualAccountProvider, MandateProvider, PayoutProvider
{
  #webhookSecret: string;
  #merchantVpa: string;
  #merchantName: string;
  #nextId = 1;
  #virtualAccounts = new Map<string, VirtualAccount>();

  constructor(options: SandboxOptions) {
    this.#webhookSecret = options.webhookSecret;
    this.#merchantVpa = options.merchantVpa ?? 'merchant@sandbox';
    this.#merchantName = options.merchantName ?? 'Sandbox Merchant';
  }

  async createRequest(_input: Parameters<ReversePennyDropProvider['createRequest']>[0]): Promise<UpiPaymentRequest> {
    return this.#upiRequest('pd', rupees(1), 'Bank account verification');
  }

  async parseWebhook(rawBody: string, signature: string): Promise<PennyDropResult> {
    const expected = Buffer.from(this.#sign(rawBody), 'hex');
    const given = Buffer.from(signature, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new Error('Webhook signature does not match');
    }
    const body: unknown = JSON.parse(rawBody);
    if (!isPennyDropResult(body)) throw new Error('Webhook body is not a penny drop result');
    return body;
  }

  /** What the provider would POST to your webhook once the customer has paid the ₹1. */
  simulatePennyDropWebhook(requestId: string, outcome: VerifiedBankAccount | { failure: string }) {
    const result: PennyDropResult =
      'failure' in outcome
        ? { requestId, status: 'failed', reason: outcome.failure }
        : { requestId, status: 'success', account: outcome };
    const rawBody = JSON.stringify(result);
    return { rawBody, signature: this.#sign(rawBody) };
  }

  async createUpiOrder(input: Parameters<PaymentGateway['createUpiOrder']>[0]): Promise<UpiPaymentRequest> {
    return this.#upiRequest('upi', input.amount, `Order ${input.orderId}`);
  }

  async createNetbankingOrder(_input: Parameters<PaymentGateway['createNetbankingOrder']>[0]) {
    const requestId = this.#id('nb');
    return { requestId, redirectUrl: `https://sandbox.invalid/netbanking/${requestId}` };
  }

  async getOrCreate(customer: Customer): Promise<VirtualAccount> {
    let account = this.#virtualAccounts.get(customer.id);
    if (!account) {
      const serial = String(this.#virtualAccounts.size + 1).padStart(8, '0');
      account = { accountNumber: `9999${serial}`, ifsc: SANDBOX_IFSC, beneficiaryName: this.#merchantName };
      this.#virtualAccounts.set(customer.id, account);
    }
    return account;
  }

  async createEnachMandate(_input: Parameters<MandateProvider['createEnachMandate']>[0]) {
    const mandateId = this.#id('mdt');
    return { mandateId, authUrl: `https://sandbox.invalid/enach/${mandateId}` };
  }

  async send(_input: Parameters<PayoutProvider['send']>[0]) {
    return { providerRef: this.#id('pout'), status: 'queued' as const };
  }

  #upiRequest(prefix: string, amount: number, note: string): UpiPaymentRequest {
    const requestId = this.#id(prefix);
    return {
      requestId,
      upiIntent: buildUpiIntent({
        payeeVpa: this.#merchantVpa,
        payeeName: this.#merchantName,
        amount,
        transactionRef: requestId,
        note,
      }),
      expiresAt: new Date(Date.now() + REQUEST_TTL_MS),
    };
  }

  #id(prefix: string): string {
    return `${prefix}_${this.#nextId++}`;
  }

  #sign(rawBody: string): string {
    return createHmac('sha256', this.#webhookSecret).update(rawBody).digest('hex');
  }
}

function isPennyDropResult(value: unknown): value is PennyDropResult {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  if (typeof body.requestId !== 'string') return false;
  if (body.status === 'failed') return typeof body.reason === 'string';
  if (body.status !== 'success' || typeof body.account !== 'object' || body.account === null) return false;
  const account = body.account as Record<string, unknown>;
  return [account.accountNumber, account.ifsc, account.holderName].every((field) => typeof field === 'string');
}

export class InMemoryAccountStore implements VerifiedAccountStore {
  #pending = new Map<string, string>();
  #accounts = new Map<string, VerifiedBankAccount>();

  async savePendingRequest(requestId: string, customerId: string) {
    this.#pending.set(requestId, customerId);
  }

  async findCustomerForRequest(requestId: string) {
    return this.#pending.get(requestId);
  }

  async saveAccount(customerId: string, account: VerifiedBankAccount) {
    this.#accounts.set(customerId, account);
  }

  async getAccount(customerId: string) {
    return this.#accounts.get(customerId);
  }
}
