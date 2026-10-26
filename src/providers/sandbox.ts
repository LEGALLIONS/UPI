import { createHmac, timingSafeEqual } from 'node:crypto';
import type { VerifiedAccountStore } from '../onboarding.ts';
import { rupees } from '../money.ts';
import { buildUpiIntent } from '../upi-intent.ts';
import type {
  BankEvent,
  ConnectedBanking,
  CreditEvent,
  CreditNotifications,
  PennyDropResult,
  ReversePennyDropProvider,
  UpiPaymentRequest,
  VerifiedBankAccount,
} from './types.ts';

// In-memory stand-ins for a partner's APIs, for tests and local development.
// Nothing here moves money. Replace with real adapters before going live.

const REQUEST_TTL_MS = 10 * 60 * 1000;

export interface SandboxOptions {
  webhookSecret: string;
  merchantVpa?: string;
  merchantName?: string;
  /** IFSC prefixes of the banks to pretend ePay has API agreements with; all banks if left out. */
  connectedBanks?: string[];
}

export class SandboxPartner implements ReversePennyDropProvider, CreditNotifications, ConnectedBanking {
  #webhookSecret: string;
  #merchantVpa: string;
  #merchantName: string;
  #connectedBanks: string[] | undefined;
  #nextId = 1;

  constructor(options: SandboxOptions) {
    this.#webhookSecret = options.webhookSecret;
    this.#merchantVpa = options.merchantVpa ?? 'merchant@sandbox';
    this.#merchantName = options.merchantName ?? 'Sandbox Merchant';
    this.#connectedBanks = options.connectedBanks;
  }

  async createRequest(_input: Parameters<ReversePennyDropProvider['createRequest']>[0]): Promise<UpiPaymentRequest> {
    return this.#upiRequest('pd', rupees(1), 'Bank account verification');
  }

  async parsePennyDropWebhook(rawBody: string, signature: string): Promise<PennyDropResult> {
    const body = this.#verify(rawBody, signature);
    if (!isPennyDropResult(body)) throw new Error('Webhook body is not a penny drop result');
    return body;
  }

  /** What the provider would POST to your webhook once the customer has paid the ₹1. */
  simulatePennyDropWebhook(requestId: string, outcome: VerifiedBankAccount | { failure: string }) {
    const result: PennyDropResult =
      'failure' in outcome
        ? { requestId, status: 'failed', reason: outcome.failure }
        : { requestId, status: 'success', account: outcome };
    return this.#signed(result);
  }

  async parseCreditWebhook(rawBody: string, signature: string): Promise<CreditEvent> {
    const body = this.#verify(rawBody, signature);
    if (!isCreditEvent(body)) throw new Error('Webhook body is not a credit');
    return body;
  }

  /** What ePay's bank would POST to your webhook when money arrives in ePay's account. */
  simulateCreditWebhook(event: CreditEvent) {
    return this.#signed(event);
  }

  supports(ifsc: string): boolean {
    return !this.#connectedBanks || this.#connectedBanks.includes(ifsc.slice(0, 4).toUpperCase());
  }

  async startLink(_input: Parameters<ConnectedBanking['startLink']>[0]) {
    return { linkId: this.#id('lnk') };
  }

  async requestSplitPayment(_input: Parameters<ConnectedBanking['requestSplitPayment']>[0]) {
    return { requestId: this.#id('spl') };
  }

  async parseBankWebhook(rawBody: string, signature: string): Promise<BankEvent> {
    const body = this.#verify(rawBody, signature);
    if (!isBankEvent(body)) throw new Error('Webhook body is not a bank event');
    return body;
  }

  /** What the payer's bank would POST to your webhook when they approve or decline. */
  simulateBankWebhook(event: BankEvent) {
    return this.#signed(event);
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
      expiresAt: new Date(Date.now() + REQUEST_TTL_MS).toISOString(),
    };
  }

  #id(prefix: string): string {
    return `${prefix}_${this.#nextId++}`;
  }

  #signed(payload: unknown) {
    const rawBody = JSON.stringify(payload);
    return { rawBody, signature: this.#sign(rawBody) };
  }

  #verify(rawBody: string, signature: string): unknown {
    const expected = Buffer.from(this.#sign(rawBody), 'hex');
    const given = Buffer.from(signature, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new Error('Webhook signature does not match');
    }
    return JSON.parse(rawBody);
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
  return (
    [account.accountNumber, account.ifsc, account.holderName].every((field) => typeof field === 'string') &&
    (account.vpa === undefined || typeof account.vpa === 'string')
  );
}

function isBankEvent(value: unknown): value is BankEvent {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  if (body.kind === 'link') {
    return typeof body.linkId === 'string' && (body.status === 'approved' || body.status === 'declined');
  }
  return (
    body.kind === 'split' &&
    typeof body.requestId === 'string' &&
    Array.isArray(body.legs) &&
    body.legs.every(
      (leg: Record<string, unknown>) =>
        (leg.part === 'payment' || leg.part === 'commission') &&
        (leg.status === 'success' || leg.status === 'failed') &&
        (leg.utr === null || typeof leg.utr === 'string'),
    )
  );
}

function isCreditEvent(value: unknown): value is CreditEvent {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return Number.isSafeInteger(body.amount) && typeof body.utr === 'string' && typeof body.remarks === 'string';
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
