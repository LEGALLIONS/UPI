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
}

export const DEFAULT_FEE_POLICY: FeePolicy = { rateBps: 20, minimum: rupees(1) };

/** 0.2% of ₹3,00,000 is ₹600. Rounded to the nearest paisa, never below the minimum. */
export function feeFor(amount: Paise, policy: FeePolicy = DEFAULT_FEE_POLICY): Paise {
  assertValidAmount(amount);
  return Math.max(policy.minimum, Math.round((amount * policy.rateBps) / 10_000));
}

/** "0.2" for 20 basis points. */
export function feePercent(policy: FeePolicy = DEFAULT_FEE_POLICY): string {
  return String(policy.rateBps / 100);
}
