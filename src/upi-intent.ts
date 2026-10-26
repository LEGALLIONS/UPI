import { toRupeeString, type Paise } from './money.ts';

export interface UpiIntentInput {
  payeeVpa: string;
  payeeName: string;
  amount: Paise;
  /** Your reference for this payment; comes back in the payment status. */
  transactionRef: string;
  note?: string;
}

const VPA = /^[a-z0-9._-]{2,256}@[a-z][a-z0-9]{1,64}$/i;

/**
 * A UPI deep link (upi://pay, per NPCI's linking spec). Opens the payer's UPI
 * app on mobile, or can be shown as a QR code on desktop.
 */
export function buildUpiIntent(input: UpiIntentInput): string {
  if (!VPA.test(input.payeeVpa)) throw new Error(`Not a UPI ID: ${input.payeeVpa}`);
  const params: [string, string][] = [
    ['pa', input.payeeVpa],
    ['pn', input.payeeName],
    ['am', toRupeeString(input.amount)],
    ['cu', 'INR'],
    ['tr', input.transactionRef],
  ];
  if (input.note) params.push(['tn', input.note]);
  // encodeURIComponent rather than URLSearchParams: some UPI apps read "+" literally instead of as a space.
  return `upi://pay?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`;
}
