import { DEFAULT_LIMITS, type RailLimits } from './limits.ts';
import type { Paise } from './money.ts';
import type { CommissionAccount, Payee } from './providers/types.ts';
import type { CollectionPlan, TransferRail } from './router.ts';
import { buildUpiIntent } from './upi-intent.ts';

export interface TransferDetails {
  amount: Paise;
  /** Opens the payer's UPI app with everything filled in. null when UPI doesn't fit. */
  upiIntent: string | null;
  bankTransfer: { accountNumber: string; ifsc: string; beneficiaryName: string; rails: TransferRail[] };
}

/**
 * What the payer sends: first the amount, straight to the payee's own account,
 * then ePay's commission by UPI. ePay never holds the amount, so there is no
 * settlement wait. ePay's account details stay out of it: payers see only the
 * commission amount and a UPI link.
 */
export interface PaymentInstructions {
  /** Goes in the UPI note or transfer remarks of both, so each can be matched to this payment. */
  reference: string;
  payment: TransferDetails;
  /** upiIntent is null when the commission is over the UPI limit; the payer then contacts ePay. */
  commission: { amount: Paise; upiIntent: string | null };
}

/** "EPAY" and 8 letters or digits, e.g. EPAY9DCCD008. */
export function referenceFor(orderId: string): string {
  return `EPAY${orderId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()}`;
}

/** The payment reference in a UPI note or transfer remarks, however the payer spaced or cased it. */
export function findReference(remarks: string): string | null {
  return /EPAY[A-Z0-9]{8}/.exec(remarks.toUpperCase().replace(/[^A-Z0-9]/g, ''))?.[0] ?? null;
}

export function paymentInstructions(
  input: { orderId: string; payee: Payee; plan: CollectionPlan; fee: Paise; commissionAccount: CommissionAccount },
  limits: RailLimits = DEFAULT_LIMITS,
): PaymentInstructions {
  const { orderId, payee, plan, fee, commissionAccount } = input;
  const reference = referenceFor(orderId);
  const upiFits = plan.options.some((option) => option.method === 'upi');
  const transfer = plan.options.find((option) => option.method === 'bank_transfer');
  const { account } = payee;
  return {
    reference,
    payment: {
      amount: plan.amount,
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
    },
    commission: {
      amount: fee,
      // ePay's UPI ID is a business one, so its link can carry the reference as the merchant reference too.
      upiIntent:
        fee <= limits.upiDefault.perTxn
          ? buildUpiIntent({
              payeeVpa: commissionAccount.upiId,
              payeeName: commissionAccount.name,
              amount: fee,
              transactionRef: reference,
              note: reference,
            })
          : null,
    },
  };
}

