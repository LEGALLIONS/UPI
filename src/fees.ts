import { assertValidAmount, rupees, type Paise } from './money.ts';

/**
 * ePay's commission, on top of the amount. The payer sends it at the same time
 * as the payment, as a separate transfer into ePay's own account, so the
 * amount itself goes straight to the payee without passing through ePay.
 */
export interface FeePolicy {
  /** In basis points: 20 = 0.2%. */
  rateBps: number;
  /** UPI's smallest payment is ₹1. */
  minimum: Paise;
  /** GST on the commission, in basis points: 1800 = 18%. */
  gstRateBps: number;
  /** true: the rate already includes GST. false: GST is added on top of it. */
  gstIncluded: boolean;
}

/** 0.2% including GST. To add GST on top instead, set gstIncluded to false. */
export const DEFAULT_FEE_POLICY: FeePolicy = { rateBps: 20, minimum: rupees(1), gstRateBps: 1800, gstIncluded: true };

/**
 * What the payer sends ePay, GST included. 0.2% of ₹3,00,000 is ₹600, or ₹708
 * with 18% GST on top. Rounded to the nearest paisa, never below the minimum.
 */
export function feeFor(amount: Paise, policy: FeePolicy = DEFAULT_FEE_POLICY): Paise {
  assertValidAmount(amount);
  const commission = Math.max(policy.minimum, Math.round((amount * policy.rateBps) / 10_000));
  return policy.gstIncluded ? commission : commission + Math.round((commission * policy.gstRateBps) / 10_000);
}

/** "0.2" for 20 basis points. */
export function feePercent(policy: FeePolicy = DEFAULT_FEE_POLICY): string {
  return String(policy.rateBps / 100);
}
