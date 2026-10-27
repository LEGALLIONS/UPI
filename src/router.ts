import { DEFAULT_LIMITS, type RailLimits, type UpiLimit, type UpiMerchantCategory } from './limits.ts';
import { assertValidAmount, formatInr, type Paise } from './money.ts';

/**
 * Ways the payer sends money. Both go straight from the payer's bank to the
 * payee's bank, so the payee has it in seconds and ePay never holds it.
 */
export type CollectionMethod = 'upi' | 'bank_transfer';

/** Bank-to-bank transfer rails. All three run 24x7. */
export type TransferRail = 'imps' | 'rtgs' | 'neft';

export interface CollectionRequest {
  amount: Paise;
  /** The payee's NPCI-verified merchant category, if it has one. Unlocks higher UPI limits. */
  merchantCategory?: UpiMerchantCategory;
  /** UPI this payer has already paid the payee today, if you track it. */
  upiPaidToday?: Paise;
  /** False when the payee has no UPI ID on file, so only bank transfer works. */
  payeeHasUpi?: boolean;
}

export interface PaymentOption {
  method: CollectionMethod;
  /** Short line to show the payer. */
  reason: string;
  /** For bank_transfer: the rails the payer can use from their banking app. */
  rails?: TransferRail[];
}

export interface UnavailableOption {
  method: CollectionMethod;
  reason: string;
}

export interface CollectionPlan {
  amount: Paise;
  upiLimit: UpiLimit;
  /** Best first, never empty. */
  options: PaymentOption[];
  unavailable: UnavailableOption[];
}

/**
 * Picks the ways a payer can send this amount. UPI comes first while it is
 * within limits; bank transfer is always offered because it has no NPCI cap.
 * A payment is never split to get round a UPI limit.
 */
export function planCollection(request: CollectionRequest, limits: RailLimits = DEFAULT_LIMITS): CollectionPlan {
  const { amount, merchantCategory, upiPaidToday = 0, payeeHasUpi = true } = request;
  assertValidAmount(amount);
  const upiLimit = merchantCategory ? limits.upiMerchantCategories[merchantCategory] : limits.upiDefault;
  const options: PaymentOption[] = [];
  const unavailable: UnavailableOption[] = [];

  const upiProblem = payeeHasUpi ? checkUpiLimit(amount, upiPaidToday, upiLimit) : 'They have no UPI ID on ePay';
  if (upiProblem) {
    unavailable.push({ method: 'upi', reason: upiProblem });
  } else {
    options.push({ method: 'upi', reason: 'Instant, from any UPI app, straight to their bank' });
  }

  options.push({
    method: 'bank_transfer',
    reason: 'From your bank app or net banking, straight to their account; no UPI limit',
    rails: planPayout({ amount, urgent: true }, limits).map((option) => option.rail),
  });

  return { amount, upiLimit, options, unavailable };
}

function checkUpiLimit(amount: Paise, paidToday: Paise, limit: UpiLimit): string | undefined {
  if (amount > limit.perTxn) {
    return `Over the ${formatInr(limit.perTxn)} UPI limit per payment`;
  }
  if (limit.perDay !== null && paidToday + amount > limit.perDay) {
    return `Would go over the ${formatInr(limit.perDay)} UPI daily limit`;
  }
  return undefined;
}

export interface PayoutRequest {
  amount: Paise;
  /** Needs to land in minutes rather than the next NEFT batch. */
  urgent?: boolean;
}

export interface PayoutOption {
  rail: TransferRail;
  reason: string;
}

/** Orders the rails this amount can be sent on, best first. */
export function planPayout(request: PayoutRequest, limits: RailLimits = DEFAULT_LIMITS): PayoutOption[] {
  const { amount, urgent = false } = request;
  assertValidAmount(amount);
  const realTime: PayoutOption[] = [];
  if (amount <= limits.impsMaxPerTxn) {
    realTime.push({ rail: 'imps', reason: `Instant, up to ${formatInr(limits.impsMaxPerTxn)}` });
  }
  if (amount >= limits.rtgsMinPerTxn) {
    realTime.push({ rail: 'rtgs', reason: `Real-time, from ${formatInr(limits.rtgsMinPerTxn)} with no upper limit` });
  }
  const neft: PayoutOption = { rail: 'neft', reason: 'Settles in half-hourly batches, no upper limit' };
  return urgent ? [...realTime, neft] : [neft, ...realTime];
}
