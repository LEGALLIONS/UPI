/** Amounts are whole paise everywhere (₹1 = 100), so no rupee value is ever a float. */
export type Paise = number;

export function rupees(amount: number): Paise {
  if (!Number.isFinite(amount)) throw new RangeError(`Not a rupee amount: ${amount}`);
  return Math.round(amount * 100);
}

export const LAKH: Paise = rupees(100_000);
export const CRORE: Paise = rupees(10_000_000);

export function assertValidAmount(amount: Paise): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError(`Amount must be a positive whole number of paise, got ${amount}`);
  }
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** "₹1,00,000.00" */
export function formatInr(amount: Paise): string {
  return inr.format(amount / 100);
}

/** "1234.50": the decimal rupee string that UPI links and most gateway APIs expect. */
export function toRupeeString(amount: Paise): string {
  assertValidAmount(amount);
  const whole = Math.floor(amount / 100);
  const fraction = String(amount % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}
