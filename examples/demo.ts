// End-to-end walk-through against the sandbox partner: npm run demo
import {
  AccountVerification,
  InMemoryAccountStore,
  LAKH,
  SandboxPartner,
  feeFor,
  feePercent,
  formatInr,
  paymentInstructions,
  planCollection,
  rupees,
  type CollectionRequest,
} from '../src/index.ts';

const partner = new SandboxPartner({ webhookSecret: 'demo-secret', merchantVpa: 'epay@okaxis', merchantName: 'ePay' });
const accounts = new InMemoryAccountStore();
const supplier = { id: 'cust_2', name: 'Meena Steels', mobile: '9000000002' };

console.log('1. A supplier signs in with mobile + OTP, then verifies their bank account with ₹1 by UPI');
const verification = new AccountVerification(partner, accounts);
const request = await verification.start(supplier.id);
console.log(`   Show as a button or QR: ${request.upiIntent}`);
const webhook = partner.simulatePennyDropWebhook(request.requestId, {
  accountNumber: '00112233445566',
  ifsc: 'ICIC0000123',
  holderName: 'MEENA STEELS',
  vpa: 'meenasteels@okicici',
});
console.log('   Webhook says:', await verification.handleWebhook(webhook.rawBody, webhook.signature));

console.log(`\n2. How a customer can pay them, and ePay's ${feePercent()}% fee`);
const scenarios: [string, CollectionRequest][] = [
  ['₹50,000 invoice', { amount: rupees(50_000) }],
  ['₹3 lakh invoice', { amount: 3 * LAKH }],
  ['₹3 lakh invoice, payee verified for business payments', { amount: 3 * LAKH, merchantCategory: 'business_payments' }],
  ['₹25 lakh invoice', { amount: 25 * LAKH }],
];
for (const [label, payment] of scenarios) {
  const plan = planCollection(payment);
  console.log(`   ${label}: fee ${formatInr(feeFor(plan.amount))}`);
  for (const option of plan.options) {
    console.log(`     ✓ ${option.method}${option.rails ? ` (${option.rails.join('/')})` : ''}: ${option.reason}`);
  }
  for (const option of plan.unavailable) console.log(`     ✗ ${option.method}: ${option.reason}`);
}

console.log('\n3. The customer pays ₹3 lakh: the amount to Meena Steels and the ₹600 commission to ePay, at the same time');
const commissionAccount = { accountNumber: '777705550001', ifsc: 'ICIC0000001', name: 'EPAY TECHNOLOGIES', upiId: 'epay@icici' };
const payee = { id: supplier.id, name: 'MEENA STEELS', account: (await accounts.getAccount(supplier.id))! };
const plan = planCollection({ amount: 3 * LAKH });
console.dir(paymentInstructions({ orderId: 'ord_1', payee, plan, fee: feeFor(plan.amount), commissionAccount }), { depth: 4 });
console.log('   Both go straight from their bank: the amount to Meena Steels, the commission to ePay. Nothing waits on a settlement.');
