// Starts the ePay API in sandbox mode: npm run server
import { networkInterfaces } from 'node:os';
import { createApiServer, createSandboxDeps } from './app.ts';

const port = Number(process.env.PORT ?? 3000);
// The phone opens the sandbox bank page, so it needs an address the phone can reach.
// Render sets RENDER_EXTERNAL_URL; on other hosts set PUBLIC_URL to the server's https address.
const publicUrl =
  process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? `http://${lanAddress() ?? 'localhost'}:${port}`;

const deps = createSandboxDeps({ publicUrl, webhookSecret: process.env.WEBHOOK_SECRET });
createApiServer(deps).listen(port, () => {
  console.log(`ePay API (sandbox, no real money) on ${publicUrl}`);
  console.log(`Run the app with EXPO_PUBLIC_API_URL=${publicUrl} if it can't find this server by itself.`);
});

function lanAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    const found = addresses?.find((address) => address.family === 'IPv4' && !address.internal);
    if (found) return found.address;
  }
  return undefined;
}
