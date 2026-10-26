import { CRORE, LAKH, type Paise } from './money.ts';

// Ceilings set by NPCI and RBI, as of NPCI's UPI limit change of 15 Sept 2025.
// They get revised, and each bank may set lower limits for its own customers,
// so in production load these from config and check the current NPCI circulars.

export interface UpiLimit {
  perTxn: Paise;
  /** null: NPCI sets no daily cap for the category (the payer's bank still may). */
  perDay: Paise | null;
}

/** Merchant categories that NPCI allows higher UPI limits for, once the merchant is verified. */
export const UPI_MERCHANT_CATEGORIES = {
  capital_markets: { perTxn: 5 * LAKH, perDay: 10 * LAKH },
  insurance: { perTxn: 5 * LAKH, perDay: 10 * LAKH },
  government_emarketplace: { perTxn: 5 * LAKH, perDay: 10 * LAKH },
  travel: { perTxn: 5 * LAKH, perDay: 10 * LAKH },
  loan_emi_collection: { perTxn: 5 * LAKH, perDay: 10 * LAKH },
  credit_card_bill: { perTxn: 5 * LAKH, perDay: 6 * LAKH },
  // Some reports give ₹5L per payment for jewellery; most give ₹2L.
  jewellery: { perTxn: 2 * LAKH, perDay: 6 * LAKH },
  term_deposit: { perTxn: 5 * LAKH, perDay: 5 * LAKH },
  business_payments: { perTxn: 5 * LAKH, perDay: null },
} satisfies Record<string, UpiLimit>;

export type UpiMerchantCategory = keyof typeof UPI_MERCHANT_CATEGORIES;

export interface RailLimits {
  /** Person-to-person UPI, and merchants outside the listed categories. */
  upiDefault: UpiLimit;
  upiMerchantCategories: Record<UpiMerchantCategory, UpiLimit>;
  impsMaxPerTxn: Paise;
  rtgsMinPerTxn: Paise;
  enachMaxPerDebit: Paise;
}

export const DEFAULT_LIMITS: RailLimits = {
  upiDefault: { perTxn: LAKH, perDay: LAKH },
  upiMerchantCategories: UPI_MERCHANT_CATEGORIES,
  impsMaxPerTxn: 5 * LAKH,
  rtgsMinPerTxn: 2 * LAKH,
  enachMaxPerDebit: CRORE,
};
