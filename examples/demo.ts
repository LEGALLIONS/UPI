// End-to-end walk-through against the sandbox partner: npm run demo
import {
  AccountVerification,
  InMemoryAccountStore,
  LAKH,
  SandboxPartner,
  formatInr,
  planCollection,
  planPayout,
  rupees,
  startPayment,
  type CollectionRequest,
} from '../src/index.ts';

const partner = new SandboxPartner({ webhookSecret: 'demo-secret', merchantVpa: 'yourbusiness@okaxis', merchantName: 'Your Business' });
const accounts = new InMemoryAccountStore();
const customer = { id: 'cust_1', name: 'Arun Traders', mobile: '9876543210' };

console.log('1. Customer signs in with mobile + OTP, then verifies their bank account with ₹1 by UPI');
const verification = new AccountVerification(partner, accounts);
const request = await verification.start(customer.id);
console.log(`   Show as a button or QR: ${request.upiIntent}`);
const webhook = partner.simulatePennyDropWebhook(request.requestId, {
  accountNumber: '50100123456789',
  ifsc: 'HDFC0001234',
  holderName: 'ARUN TRADERS',
});
console.log('   Webhook says:', await verification.handleWebhook(webhook.rawBody, webhook.signature));

console.log('\n2. Choose how to collect each payment');
const scenarios: [string, CollectionRequest][] = [
  ['₹50,000 invoice', { amount: rupees(50_000) }],
  ['₹3 lakh invoice, ordinary merchant', { amount: 3 * LAKH }],
  ['₹3 lakh invoice, verified business-payments merchant', { amount: 3 * LAKH, merchantCategory: 'business_payments' }],
  ['₹25 lakh monthly contract payment', { amount: 25 * LAKH, recurring: true }],
];
for (const [label, collection] of scenarios) {
  const plan = planCollection(collection);
  console.log(`   ${label}`);
  for (const option of plan.options) {
    console.log(`     ✓ ${option.method}${option.rails ? ` (${option.rails.join('/')})` : ''}: ${option.reason}`);
  }
  for (const option of plan.unavailable) console.log(`     ✗ ${option.method}: ${option.reason}`);
}

console.log('\n3. Customer pays a ₹3 lakh invoice to a supplier by net banking');
const payee = {
  id: 'cust_2',
  name: 'Meena Steels',
  account: { accountNumber: '00112233445566', ifsc: 'ICIC0000123', holderName: 'MEENA STEELS' },
};
const plan = planCollection({ amount: 3 * LAKH });
const providers = { gateway: partner, virtualAccounts: partner, mandates: partner, accounts };
const returnUrl = 'https://example.com/paid';
console.log('  ', await startPayment({ orderId: 'ord_1', payer: customer, payee, plan, method: 'netbanking', returnUrl }, providers));

console.log('\n4. Refund ₹12 lakh to the customer today, to the account verified in step 1');
const payoutOptions = planPayout({ amount: 12 * LAKH, urgent: true });
for (const option of payoutOptions) console.log(`   ${option.rail}: ${option.reason}`);
const beneficiary = await accounts.getAccount(customer.id);
if (!beneficiary || !payoutOptions[0]) throw new Error('Nothing to pay out to');
const payout = await partner.send({
  payoutId: 'pay_1',
  amount: 12 * LAKH,
  rail: payoutOptions[0].rail,
  beneficiary,
  narration: 'Refund ord_1',
});
console.log(`   Sent ${formatInr(12 * LAKH)} by ${payoutOptions[0].rail}:`, payout);
