import type { Paise } from '../money.ts';
import type { TransferRail } from '../router.ts';

// What ePay needs from partners. Payments go straight from the payer's bank to
// the payee's, and the commission straight to ePay's own account, so ePay only
// needs account verification (Cashfree, Setu, Decentro and others offer it),
// credit notifications from its own bank, and, for payments with one approval,
// API banking with the payer's bank.

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

/** ePay's own bank account, where commissions are paid. It never changes, so payers add it as a beneficiary once. */
export interface CommissionAccount {
  accountNumber: string;
  ifsc: string;
  name: string;
  upiId: string;
}

/** Money arriving in ePay's own account, as its bank reports it. */
export interface CreditEvent {
  amount: Paise;
  /** The bank's reference for the transfer. */
  utr: string;
  /** The UPI note or transfer remarks, where the payer puts the payment's reference. */
  remarks: string;
}

/** ePay's own bank telling ePay about each credit to its account (API banking). */
export interface CreditNotifications {
  /** Checks the webhook signature, then parses the body. Throws if the signature is wrong. */
  parseCreditWebhook(rawBody: string, signature: string): Promise<CreditEvent>;
}

/** One part of a split payment: the amount to the payee, or the commission to ePay. */
export interface SplitLeg {
  part: 'payment' | 'commission';
  amount: Paise;
  rail: TransferRail;
  beneficiary: { accountNumber: string; ifsc: string; name: string };
  /** Goes in the transfer's remarks. */
  reference: string;
}

/** What the payer's bank reports back. */
export type BankEvent =
  | { kind: 'link'; linkId: string; status: 'approved' | 'declined' }
  | {
      kind: 'split';
      requestId: string;
      /** Each part's outcome; utr is the bank's reference when it went through. */
      legs: { part: SplitLeg['part']; status: 'success' | 'failed'; utr: string | null }[];
    };

/**
 * A payer's current account connected to ePay through their bank's API
 * (connected banking). ePay asks the bank to send both parts of a payment;
 * the payer approves once, in their bank's app or net banking.
 */
export interface ConnectedBanking {
  /** Whether ePay has an API agreement with this account's bank. */
  supports(ifsc: string): boolean;
  /** The payer approves ePay in their bank's net banking, once; the result comes by webhook. */
  startLink(input: { customerId: string; account: VerifiedBankAccount }): Promise<{ linkId: string }>;
  /** Puts both parts to the payer's bank for one approval; the outcome comes by webhook. */
  requestSplitPayment(input: { linkId: string; legs: SplitLeg[] }): Promise<{ requestId: string }>;
  /** Checks the webhook signature, then parses the body. Throws if the signature is wrong. */
  parseBankWebhook(rawBody: string, signature: string): Promise<BankEvent>;
}
