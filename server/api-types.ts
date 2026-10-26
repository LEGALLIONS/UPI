// The HTTP API between the ePay app and this server. The app imports these types too.
import type { PaymentInstructions } from '../src/checkout.ts';
import type { Paise } from '../src/money.ts';
import type { MaskedBankAccount } from '../src/onboarding.ts';
import type { UpiPaymentRequest } from '../src/providers/types.ts';
import type { CollectionMethod, CollectionPlan } from '../src/router.ts';

export type { CollectionMethod, CollectionPlan, MaskedBankAccount, Paise, PaymentInstructions, UpiPaymentRequest };

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

/** The ways to send the amount, plus ePay's fee, which the payer pays separately. */
export interface PlanView extends CollectionPlan {
  fee: Paise;
  /** "0.2" */
  feePercent: string;
}

export type PaymentRequest = PlanRequest;

/**
 * awaiting_fee: the payer pays ePay's fee by UPI; the partner confirms it by webhook.
 * awaiting_transfer: the payer sends the amount straight to the payee's bank.
 * sent: the payer has given the bank reference; the payee checks their account.
 * received: the payee has confirmed. Done.
 * not_received: the payee can't find it; the payer checks and gives the reference again.
 */
export type OrderStatus = 'awaiting_fee' | 'awaiting_transfer' | 'sent' | 'received' | 'not_received';

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
  /** Payer only, while the fee is unpaid. */
  feeRequest: UpiPaymentRequest | null;
  /** The last fee payment failed; the payer can ask for a new one. */
  feeFailed: boolean;
  /** Payer only, once the fee is paid: where to send the money. */
  instructions: PaymentInstructions | null;
  /** Short code the payer puts in the transfer's remarks, for the payee to spot in their statement. */
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

export interface SandboxFeeRequest {
  status?: 'success' | 'failed';
}
