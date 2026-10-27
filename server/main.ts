// Starts the ePay API in sandbox mode: npm run server
import { networkInterfaces } from 'node:os';
import type { CommissionAccount } from '../src/providers/types.ts';
import { createApiServer, createSandboxDeps } from './app.ts';

const port = Number(process.env.PORT ?? 3000);
// The address the app should use: Render sets RENDER_EXTERNAL_URL; elsewhere set PUBLIC_URL.
const publicUrl =
  process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? `http://${lanAddress() ?? 'localhost'}:${port}`;

const commissionAccount = commissionAccountFromEnv();
// ADMIN_TOKEN is ePay staff's key for reviewing complaints; without it, the /admin routes are off.
const deps = createSandboxDeps({ webhookSecret: process.env.WEBHOOK_SECRET, commissionAccount, adminToken: process.env.ADMIN_TOKEN });
createApiServer(deps).listen(port, () => {
  console.log(`ePay API (sandbox, no real money) on ${publicUrl}`);
  console.log(`Commissions go to ${deps.commissionAccount.name}, ${deps.commissionAccount.accountNumber} / ${deps.commissionAccount.upiId}`);
  console.log(`Run the app with EXPO_PUBLIC_API_URL=${publicUrl} if it can't find this server by itself.`);
});

/** ePay's own account for commissions. All four settings, or none for the sandbox account. */
function commissionAccountFromEnv(): CommissionAccount | undefined {
  const { EPAY_ACCOUNT_NUMBER, EPAY_IFSC, EPAY_ACCOUNT_NAME, EPAY_UPI_ID } = process.env;
  const settings = [EPAY_ACCOUNT_NUMBER, EPAY_IFSC, EPAY_ACCOUNT_NAME, EPAY_UPI_ID];
  if (settings.every((value) => !value)) return undefined;
  if (!EPAY_ACCOUNT_NUMBER || !EPAY_IFSC || !EPAY_ACCOUNT_NAME || !EPAY_UPI_ID) {
    throw new Error('Set all of EPAY_ACCOUNT_NUMBER, EPAY_IFSC, EPAY_ACCOUNT_NAME and EPAY_UPI_ID, or none of them');
  }
  return { accountNumber: EPAY_ACCOUNT_NUMBER, ifsc: EPAY_IFSC, name: EPAY_ACCOUNT_NAME, upiId: EPAY_UPI_ID };
}

function lanAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    const found = addresses?.find((address) => address.family === 'IPv4' && !address.internal);
    if (found) return found.address;
  }
  return undefined;
}
