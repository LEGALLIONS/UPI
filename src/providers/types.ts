import type { Paise } from '../money.ts';
import type { TransferRail } from '../router.ts';

// What this project needs from a licensed partner (payment aggregator or bank).
// Each interface maps to an API that Cashfree, Razorpay, Setu, Decentro and
// others already offer; write one adapter per partner.

/** Account details reported by the bank itself, never typed in by the customer. */
export interface VerifiedBankAccount {
  accountNumber: string;
  ifsc: string;
  holderName: string;
}

export interface Customer {
  id: string;
  name: string;
  mobile: string;
}

/**
 * Who receives a payment. The partner settles straight to their verified
 * account (split settlement / linked accounts), so the money never sits with us.
 */
export interface Payee {
  id: string;
  name: string;
  account: VerifiedBankAccount;
}

export interface UpiPaymentRequest {
  requestId: string;
  upiIntent: string;
  /** ISO 8601 */
  expiresAt: string;
}

export type PennyDropResult =
  | { requestId: string; status: 'success'; account: VerifiedBankAccount }
  | { requestId: string; status: 'failed'; reason: string };

/**
 * Reverse penny drop: the customer pays ₹1 by UPI from their own app, and the
 * provider reports the account number, IFSC and name it came from (and refunds the ₹1).
 */
export interface ReversePennyDropProvider {
  createRequest(input: { referenceId: string }): Promise<UpiPaymentRequest>;
  /** Checks the webhook signature, then parses the body. Throws if the signature is wrong. */
  parsePennyDropWebhook(rawBody: string, signature: string): Promise<PennyDropResult>;
}

/** What a partner's payment webhook reports. */
export type PaymentEvent =
  /** A UPI or net banking order finished, or an e-NACH mandate was approved or refused. */
  | { kind: 'order'; requestId: string; status: 'success' | 'failed' }
  /** Money arrived in a virtual account. utr is the bank's reference for the transfer. */
  | { kind: 'transfer'; virtualAccountNumber: string; amount: Paise; utr: string };

export interface OrderInput {
  orderId: string;
  amount: Paise;
  payer: Customer;
  payee: Payee;
}

export interface PaymentGateway {
  /** UPI through the gateway, so the payee's verified-category limits apply. */
  createUpiOrder(input: OrderInput): Promise<UpiPaymentRequest>;
  /** The redirect goes to the payer's bank's own login page; their credentials never reach us. */
  createNetbankingOrder(input: OrderInput & { returnUrl: string }): Promise<{ requestId: string; redirectUrl: string }>;
  /** Checks the webhook signature, then parses the body. Throws if the signature is wrong. */
  parsePaymentWebhook(rawBody: string, signature: string): Promise<PaymentEvent>;
}

export interface VirtualAccount {
  accountNumber: string;
  ifsc: string;
  beneficiaryName: string;
}

export interface VirtualAccountProvider {
  /**
   * Same account every time for a payer and payee, so the payer adds it as a
   * beneficiary in their bank once and every transfer matches up automatically.
   */
  getOrCreate(input: { payer: Customer; payee: Payee }): Promise<VirtualAccount>;
}

export interface MandateProvider {
  /** The payer approves on their bank's page; the bank then allows debits up to maxAmount. */
  createEnachMandate(input: {
    payer: Customer;
    payerAccount: VerifiedBankAccount;
    payee: Payee;
    maxAmount: Paise;
    returnUrl: string;
  }): Promise<{ mandateId: string; authUrl: string }>;
}

export interface PayoutProvider {
  send(input: {
    payoutId: string;
    amount: Paise;
    rail: TransferRail;
    beneficiary: VerifiedBankAccount;
    narration: string;
  }): Promise<{ providerRef: string; status: 'queued' | 'processing' }>;
}
