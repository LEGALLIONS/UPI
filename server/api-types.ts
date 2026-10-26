// The HTTP API between the ePay app and this server. The app imports these types too.
import type { TransferDetails } from '../src/checkout.ts';
import type { Paise } from '../src/money.ts';
import type { MaskedBankAccount } from '../src/onboarding.ts';
import type { UpiPaymentRequest } from '../src/providers/types.ts';
import type { CollectionMethod, CollectionPlan } from '../src/router.ts';

export type { CollectionMethod, CollectionPlan, MaskedBankAccount, Paise, TransferDetails, UpiPaymentRequest };

/**
 * What the payer sees: where to send the amount, and only the amount of the
 * commission with a UPI link for it. ePay's account details stay on the server.
 */
export interface PayerInstructions {
  reference: string;
  payment: TransferDetails;
  /** upiIntent is null when the commission is over the UPI limit; it then goes with one approval. */
  commission: { amount: Paise; upiIntent: string | null };
}

export interface ErrorResponse {
  error: string;
}

export interface ConfigResponse {
  /** True when no real money moves; the app then offers buttons to simulate each step. */
  sandbox: boolean;
}

export interface OtpRequest {
  mobile: string;
}

export interface OtpResponse {
  sent: true;
  /** Sandbox only: the code that would have gone by SMS. */
  devCode?: string;
}

export interface SessionRequest {
  mobile: string;
  code: string;
}

export interface SessionResponse {
  token: string;
  me: MeView;
}

export interface MeView {
  id: string;
  mobile: string;
  /** null until the ₹1 UPI verification has gone through. */
  account: MaskedBankAccount | null;
  /** The UPI ID others can pay this account on, if the bank reported one. */
  upiId: string | null;
  /** "HDFC Bank", from the IFSC; null before verification or for a bank ePay doesn't know. */
  bankName: string | null;
  /**
   * One-approval payments through the bank's API: unsupported (no agreement with
   * this bank yet), not_linked, pending (waiting for approval in the bank), linked, declined.
   */
  oneApproval: 'unsupported' | 'not_linked' | 'pending' | 'linked' | 'declined';
}

/** Shown to a payer before they pay, so they can check they have the right person. */
export interface PayeeView {
  id: string;
  /** As the bank has it, not as the payee typed it. */
  name: string;
  maskedAccountNumber: string;
  ifsc: string;
}

export interface PlanRequest {
  payeeId: string;
  amount: Paise;
}

/** The ways to send the amount, plus ePay's commission, which the payer sends at the same time to ePay's account. */
export interface PlanView extends CollectionPlan {
  fee: Paise;
  /** "0.2" */
  feePercent: string;
}

export type PaymentRequest = PlanRequest;

/**
 * The payment itself; the commission is tracked separately in commissionPaid.
 * awaiting_transfer: the payer sends the amount straight to the payee's bank.
 * sent: the payer has given the bank reference; the payee checks their account.
 * received: the payee has confirmed. Done.
 * not_received: the payee can't find it; the payer checks and gives the reference again.
 */
export type OrderStatus = 'awaiting_transfer' | 'sent' | 'received' | 'not_received';

export interface PartyView {
  id: string;
  name: string;
}

export interface OrderView {
  id: string;
  /** Whether the person looking is paying or being paid. */
  role: 'payer' | 'payee';
  payer: PartyView;
  payee: PayeeView;
  amount: Paise;
  fee: Paise;
  status: OrderStatus;
  /** Whether ePay's bank has reported the commission arriving. null for the payee, who doesn't pay it. */
  commissionPaid: boolean | null;
  /** Payer only: where to send the amount, and the commission to pay. */
  instructions: PayerInstructions | null;
  /** Payer only: whatever is still to send can go to their bank for one approval now. */
  oneApproval: boolean;
  /** Payer only: the latest request to their bank, if any. */
  bankRequest: { status: 'pending' | 'done' | 'failed'; parts: ('payment' | 'commission')[]; failedParts: ('payment' | 'commission')[] } | null;
  /** Short code in the UPI note or transfer remarks, for matching the transfers to this payment. */
  reference: string;
  /** The bank's reference for the transfer, as the payer gave it. */
  utr: string | null;
  createdAt: string;
}

export interface SentRequest {
  utr: string;
}

export interface SandboxPennyDropRequest {
  requestId: string;
  /** The name the pretend bank reports for the account. */
  holderName?: string;
}

export interface SandboxBankRequest {
  /** commission_fails: the amount goes through but the commission doesn't. */
  outcome?: 'approve' | 'decline' | 'commission_fails';
}

export interface SandboxCommissionRequest {
  /** The remarks the pretend transfer carries; defaults to the payment's reference. */
  remarks?: string;
}
