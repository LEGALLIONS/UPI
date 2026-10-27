// The HTTP API between the ePay app and this server. The app imports these types too.
import type { PaymentInstructions, TransferDetails } from '../src/checkout.ts';
import type { Paise } from '../src/money.ts';
import type { MaskedBankAccount } from '../src/onboarding.ts';
import type { UpiPaymentRequest } from '../src/providers/types.ts';
import type { CollectionMethod, CollectionPlan } from '../src/router.ts';

export type { CollectionMethod, CollectionPlan, MaskedBankAccount, Paise, PaymentInstructions, TransferDetails, UpiPaymentRequest };

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

/** The ways to send the amount, plus ePay's commission, which the payer sends by UPI once the amount has gone. */
export interface PlanView extends CollectionPlan {
  /** What the payer sends ePay, GST included. */
  fee: Paise;
  /** "0.2" */
  feePercent: string;
  /** true: feePercent includes GST. false: GST was added on top of it. */
  gstIncluded: boolean;
}

export type PaymentRequest = PlanRequest;

/**
 * The payment itself; the commission is tracked separately in commissionPaid.
 * awaiting_transfer: the payer sends the amount straight to the payee's bank.
 * sent: the payer says it has gone; the payee checks their account.
 * received: the payee has confirmed it arrived (they can before the payer says it has gone). Done.
 * not_received: the payee can't find it; the payer checks with their bank and says it has gone again.
 * Once it's sent or received, ePay's commission is due.
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
  /** Payer only: where to send the amount, and then the commission to pay. */
  instructions: PaymentInstructions | null;
  /** Short code in the UPI note or transfer remarks, for matching the transfers to this payment. */
  reference: string;
  createdAt: string;
}

export interface SandboxPennyDropRequest {
  requestId: string;
  /** The name the pretend bank reports for the account. */
  holderName?: string;
}

export interface SandboxCommissionRequest {
  /** The remarks the pretend transfer carries; defaults to the payment's reference. */
  remarks?: string;
}
