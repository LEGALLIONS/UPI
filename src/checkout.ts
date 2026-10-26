import type { Payee } from './providers/types.ts';
import type { CollectionPlan, TransferRail } from './router.ts';
import { buildUpiIntent } from './upi-intent.ts';

/**
 * How the payer sends the money: straight to the payee's own bank account,
 * by UPI or bank transfer. ePay never holds it, so there is no settlement wait.
 */
export interface PaymentInstructions {
  /** Short code for the transfer's remarks, so the payee can match it in their statement. */
  reference: string;
  /** Opens the payer's UPI app with the payee and amount filled in. null when UPI doesn't fit this payment. */
  upiIntent: string | null;
  bankTransfer: { accountNumber: string; ifsc: string; beneficiaryName: string; rails: TransferRail[] };
}

export function paymentInstructions(input: { orderId: string; payee: Payee; plan: CollectionPlan }): PaymentInstructions {
  const { orderId, payee, plan } = input;
  const reference = `EPAY${orderId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()}`;
  const upiFits = plan.options.some((option) => option.method === 'upi');
  const transfer = plan.options.find((option) => option.method === 'bank_transfer');
  const { account } = payee;
  return {
    reference,
    upiIntent:
      upiFits && account.vpa
        ? buildUpiIntent({ payeeVpa: account.vpa, payeeName: payee.name, amount: plan.amount, note: reference })
        : null,
    bankTransfer: {
      accountNumber: account.accountNumber,
      ifsc: account.ifsc,
      beneficiaryName: account.holderName,
      rails: transfer?.rails ?? [],
    },
  };
}
