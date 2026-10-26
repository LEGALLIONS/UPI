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

export interface UpiPaymentRequest {
  requestId: string;
  upiIntent: string;
  expiresAt: Date;
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
  parseWebhook(rawBody: string, signature: string): Promise<PennyDropResult>;
}

export interface PaymentGateway {
  /** UPI through the gateway, so the merchant's verified-category limits apply. */
  createUpiOrder(input: { orderId: string; amount: Paise; customer: Customer }): Promise<UpiPaymentRequest>;
  /** The redirect goes to the payer's bank's own login page; their credentials never reach us. */
  createNetbankingOrder(input: {
    orderId: string;
    amount: Paise;
    customer: Customer;
    returnUrl: string;
  }): Promise<{ requestId: string; redirectUrl: string }>;
}

export interface VirtualAccount {
  accountNumber: string;
  ifsc: string;
  beneficiaryName: string;
}

export interface VirtualAccountProvider {
  /** Returns the same account each time for a customer, so their transfers match up automatically. */
  getOrCreate(customer: Customer): Promise<VirtualAccount>;
}

export interface MandateProvider {
  /** The customer approves on their bank's page; the bank then allows debits up to maxAmount. */
  createEnachMandate(input: {
    customer: Customer;
    account: VerifiedBankAccount;
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
