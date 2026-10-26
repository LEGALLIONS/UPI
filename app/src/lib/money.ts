// Amounts are whole paise (₹1 = 100), as in the API.

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** "₹3,00,000.00" */
export function formatInr(paise: number): string {
  return inr.format(paise / 100);
}

/** What someone typed, e.g. "3,00,000" or "₹1500.5", in paise. null if it isn't an amount. */
export function parseRupees(text: string): number | null {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text.replace(/[₹,\s]/g, ''));
  if (!match) return null;
  const paise = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return paise > 0 ? paise : null;
}

const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join('-');
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

/** Indian numbering, as on a cheque: "Rupees three lakh fifty thousand only". Catches a missing or extra zero. */
export function amountInWords(paise: number): string {
  let rupees = Math.floor(paise / 100);
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  if (crore) parts.push(`${crore >= 1000 ? amountInWords(crore * 100).replace(/^Rupees | only$/g, '') : belowThousand(crore)} crore`);
  rupees %= 10_000_000;
  const lakh = Math.floor(rupees / 100_000);
  if (lakh) parts.push(`${belowHundred(lakh)} lakh`);
  rupees %= 100_000;
  const thousand = Math.floor(rupees / 1000);
  if (thousand) parts.push(`${belowHundred(thousand)} thousand`);
  rupees %= 1000;
  if (rupees) parts.push(belowThousand(rupees));
  const paiseWords = paise % 100 ? ` and ${belowHundred(paise % 100)} paise` : '';
  return `Rupees ${parts.join(' ') || 'zero'}${paiseWords} only`;
}
