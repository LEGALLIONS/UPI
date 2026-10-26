import type { Paise } from '../money.ts';
import type { TransferRail } from '../router.ts';

// What ePay needs from a licensed partner (payment aggregator or bank). Payments
// themselves go straight from payer's bank to payee's bank, so a partner is only
// needed to verify bank accounts and to collect ePay's own fee. Each interface
// maps to an API that Cashfree, Razorpay, Setu, Decentro and others offer.

/** Account details reported by the bank itself, never typed in by the customer. */
export interface VerifiedBankAccount {
  accountNumber: string;
  ifsc: string;
  holderName: string;
  /** The UPI ID the ₹1 came from, so others can pay this account by UPI. */
  vpa?: string;
}

export interface Customer {
  id: string;
  name: string;
  mobile: string;
}

/** Who receives a payment, straight into their verified account. */
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
 * provider reports the account number, IFSC, name and UPI ID it came from (and refunds the ₹1).
 */
export interface ReversePennyDropProvider {
  createRequest(input: { referenceId: string }): Promise<UpiPaymentRequest>;
  /** Checks the webhook signature, then parses the body. Throws if the signature is wrong. */
  parsePennyDropWebhook(rawBody: string, signature: string): Promise<PennyDropResult>;
}

/** A UPI payment into ePay's own account finished. */
export interface PaymentEvent {
  requestId: string;
  status: 'success' | 'failed';
}

/** Collects payments into ePay's own account: ePay's fee. Settlement time doesn't matter here. */
export interface PaymentGateway {
  createUpiOrder(input: { orderId: string; amount: Paise; payer: Customer }): Promise<UpiPaymentRequest>;
  /** Checks the webhook signature, then parses the body. Throws if the signature is wrong. */
  parsePaymentWebhook(rawBody: string, signature: string): Promise<PaymentEvent>;
}

/** Sends money from a business's own current account through its bank's API (connected banking). */
export interface PayoutProvider {
  send(input: {
    payoutId: string;
    amount: Paise;
    rail: TransferRail;
    beneficiary: VerifiedBankAccount;
    narration: string;
  }): Promise<{ providerRef: string; status: 'queued' | 'processing' }>;
}
