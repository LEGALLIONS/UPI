import type { Paise } from '../money.ts';

// What ePay needs from partners. Payments go straight from the payer's bank to
// the payee's, and the commission straight to ePay's own account, so ePay only
// needs account verification (Cashfree, Setu, Decentro and others offer it) and
// credit notifications from its own bank.

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

/** ePay's own bank account, where commissions are paid by UPI. Only its name and UPI ID reach payers. */
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
