import { DEFAULT_LIMITS, type RailLimits, type UpiLimit, type UpiMerchantCategory } from './limits.ts';
import { assertValidAmount, formatInr, type Paise } from './money.ts';

/** Ways a customer can pay a business. */
export type CollectionMethod = 'upi' | 'netbanking' | 'bank_transfer' | 'enach';

/** Bank-to-bank transfer rails. All three run 24x7. */
export type TransferRail = 'imps' | 'rtgs' | 'neft';

export interface CollectionRequest {
  amount: Paise;
  /** The merchant's NPCI-verified category, if it has one. Unlocks higher UPI limits. */
  merchantCategory?: UpiMerchantCategory;
  /** UPI this payer has already paid you today, if you track it. */
  upiPaidToday?: Paise;
  /** One debit in a repeating schedule: rent, EMIs, a supplier contract. */
  recurring?: boolean;
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
 * Picks the ways a customer can pay this amount. UPI comes first while it is
 * within limits; net banking and bank transfer are always offered because
 * they have no NPCI cap. A payment is never split to get round a UPI limit.
 */
export function planCollection(request: CollectionRequest, limits: RailLimits = DEFAULT_LIMITS): CollectionPlan {
  const { amount, merchantCategory, upiPaidToday = 0, recurring = false } = request;
  assertValidAmount(amount);
  const upiLimit = merchantCategory ? limits.upiMerchantCategories[merchantCategory] : limits.upiDefault;
  const options: PaymentOption[] = [];
  const unavailable: UnavailableOption[] = [];

  if (recurring) {
    if (amount <= limits.enachMaxPerDebit) {
      options.push({ method: 'enach', reason: 'Approve once with net banking or debit card; later debits are automatic' });
    } else {
      unavailable.push({ method: 'enach', reason: `Over the ${formatInr(limits.enachMaxPerDebit)} e-NACH limit per debit` });
    }
  }

  const upiProblem = checkUpiLimit(amount, upiPaidToday, upiLimit);
  if (upiProblem) {
    unavailable.push({ method: 'upi', reason: upiProblem });
  } else {
    options.push({ method: 'upi', reason: 'Instant, from any UPI app' });
  }

  options.push({ method: 'netbanking', reason: "Log in on your bank's own page; your bank sets the limit" });
  options.push({
    method: 'bank_transfer',
    reason: 'Send from your banking app to your own account number with us; no UPI limit',
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

/** Orders the rails a business can send this amount on, best first. */
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
