/** Banks by the first four letters of their IFSC. */
const BANK_NAMES: Record<string, string> = {
  AUBL: 'AU Small Finance Bank',
  BARB: 'Bank of Baroda',
  CNRB: 'Canara Bank',
  FDRL: 'Federal Bank',
  HDFC: 'HDFC Bank',
  ICIC: 'ICICI Bank',
  IDFB: 'IDFC FIRST Bank',
  INDB: 'IndusInd Bank',
  KKBK: 'Kotak Mahindra Bank',
  PUNB: 'Punjab National Bank',
  RATN: 'RBL Bank',
  SBIN: 'State Bank of India',
  UBIN: 'Union Bank of India',
  UTIB: 'Axis Bank',
  YESB: 'Yes Bank',
};

/** "HDFC Bank" for HDFC0001234, or null for a bank not in the list. */
export function bankName(ifsc: string): string | null {
  return BANK_NAMES[ifsc.slice(0, 4).toUpperCase()] ?? null;
}
