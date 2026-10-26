// The HTTP API between the ePay app and this server. The app imports these types too.
import type { PaymentInstruction } from '../src/checkout.ts';
import type { Paise } from '../src/money.ts';
import type { MaskedBankAccount } from '../src/onboarding.ts';
import type { UpiPaymentRequest } from '../src/providers/types.ts';
import type { CollectionMethod, CollectionPlan } from '../src/router.ts';

export type { CollectionMethod, CollectionPlan, MaskedBankAccount, Paise, PaymentInstruction, UpiPaymentRequest };

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
  recurring?: boolean;
}

export interface PaymentRequest extends PlanRequest {
  method: CollectionMethod;
  /** The app's deep link; the bank sends the payer back here after net banking or e-NACH. */
  returnUrl: string;
}

/** For e-NACH, completed means the mandate was approved. */
export type OrderStatus = 'pending' | 'completed' | 'failed';

export interface OrderView {
  id: string;
  payee: PayeeView;
  amount: Paise;
  method: CollectionMethod;
  status: OrderStatus;
  instruction: PaymentInstruction;
  /** The bank's reference for a completed bank transfer. */
  utr: string | null;
  createdAt: string;
}

export interface SandboxPennyDropRequest {
  requestId: string;
  /** The name the pretend bank reports for the account. */
  holderName?: string;
}

export interface SandboxCompleteRequest {
  status?: 'success' | 'failed';
}
