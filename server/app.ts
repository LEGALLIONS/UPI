import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { MethodUnavailableError, startPayment } from '../src/checkout.ts';
import { formatInr } from '../src/money.ts';
import { AccountVerification, maskAccount, type VerifiedAccountStore } from '../src/onboarding.ts';
import { InMemoryAccountStore, SandboxPartner } from '../src/providers/sandbox.ts';
import type {
  Customer,
  MandateProvider,
  Payee,
  PaymentEvent,
  PaymentGateway,
  ReversePennyDropProvider,
  VerifiedBankAccount,
  VirtualAccountProvider,
} from '../src/providers/types.ts';
import { planCollection, type CollectionMethod } from '../src/router.ts';
import type { ConfigResponse, MeView, OrderView, OtpResponse, PayeeView, SessionResponse } from './api-types.ts';
import { normalizeMobile, OtpService, OtpTooSoonError, RateLimiter, SandboxOtpSender, Sessions } from './auth.ts';
import { sandboxBankPage } from './sandbox-bank-page.ts';
import { MemoryStore, newOrderId, type Order, type User } from './store.ts';

export interface ApiDeps {
  pennyDrop: ReversePennyDropProvider;
  gateway: PaymentGateway;
  virtualAccounts: VirtualAccountProvider;
  mandates: MandateProvider;
  accounts: VerifiedAccountStore;
  store: MemoryStore;
  otp: OtpService;
  sessions: Sessions;
  payeeLookups: RateLimiter;
  /** Deep links the bank may send payers back to, e.g. "epay://". Anything else is refused. */
  returnUrlPrefixes: string[];
  /** Present only in sandbox mode: enables the /sandbox routes that simulate each step. */
  sandbox?: { partner: SandboxPartner; otpSender: SandboxOtpSender };
}

export function createSandboxDeps(options: { publicUrl: string; webhookSecret?: string }) {
  const partner = new SandboxPartner({
    webhookSecret: options.webhookSecret ?? randomBytes(32).toString('hex'),
    merchantVpa: 'epay@sandbox',
    merchantName: 'ePay',
    bankPageUrl: `${options.publicUrl}/sandbox/bank`,
  });
  const otpSender = new SandboxOtpSender();
  return {
    pennyDrop: partner,
    gateway: partner,
    virtualAccounts: partner,
    mandates: partner,
    accounts: new InMemoryAccountStore(),
    store: new MemoryStore(),
    otp: new OtpService(otpSender),
    sessions: new Sessions(),
    payeeLookups: new RateLimiter(30, 60 * 60 * 1000),
    // exp:// is Expo Go during development.
    returnUrlPrefixes: ['epay://', 'exp://', 'exps://'],
    sandbox: { partner, otpSender },
  } satisfies ApiDeps;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Reply = { status: number; json: unknown } | { status: number; html: string } | { status: 303; location: string };

interface Context {
  req: IncomingMessage;
  params: string[];
  body: string;
}

type Route = [method: string, path: RegExp, handler: (ctx: Context) => Promise<Reply>];

const MAX_BODY_BYTES = 64 * 1024;
const COLLECTION_METHODS: CollectionMethod[] = ['upi', 'netbanking', 'bank_transfer', 'enach'];

export function createApiServer(deps: ApiDeps): Server {
  const { store, accounts, sandbox } = deps;
  const verification = new AccountVerification(deps.pennyDrop, accounts);
  const json = (value: unknown, status = 200): Reply => ({ status, json: value });

  async function signedInUser(ctx: Context): Promise<User> {
    const token = ctx.req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const userId = token ? deps.sessions.userFor(token) : undefined;
    const user = userId ? store.getUser(userId) : undefined;
    if (!user) throw new HttpError(401, 'Sign in again');
    return user;
  }

  async function verifiedPayer(ctx: Context): Promise<{ user: User; payer: Customer }> {
    const user = await signedInUser(ctx);
    const account = await accounts.getAccount(user.id);
    if (!account) throw new HttpError(403, 'Verify your bank account first');
    return { user, payer: { id: user.id, name: account.holderName, mobile: user.mobile } };
  }

  async function payeeById(id: string, payerId: string): Promise<{ user: User; payee: Payee }> {
    const user = store.getUser(id);
    const account = user ? await accounts.getAccount(user.id) : undefined;
    if (!user || !account) throw new HttpError(404, 'No verified ePay user with that ID');
    if (user.id === payerId) throw new HttpError(400, "You can't pay yourself");
    return { user, payee: { id: user.id, name: account.holderName, account } };
  }

  async function meView(user: User): Promise<MeView> {
    const account = await accounts.getAccount(user.id);
    return { id: user.id, mobile: user.mobile, account: account ? maskAccount(account) : null };
  }

  function payeeView(id: string, account: VerifiedBankAccount): PayeeView {
    const masked = maskAccount(account);
    return { id, name: account.holderName, maskedAccountNumber: masked.maskedAccountNumber, ifsc: account.ifsc };
  }

  async function orderView(order: Order): Promise<OrderView> {
    const account = await accounts.getAccount(order.payeeId);
    if (!account) throw new Error(`Payee ${order.payeeId} of ${order.id} has no account`);
    return {
      id: order.id,
      payee: payeeView(order.payeeId, account),
      amount: order.amount,
      method: order.method,
      status: order.status,
      instruction: order.instruction,
      utr: order.utr,
      createdAt: order.createdAt.toISOString(),
    };
  }

  async function handlePaymentWebhook(rawBody: string, signature: string): Promise<boolean> {
    let event: PaymentEvent;
    try {
      event = await deps.gateway.parsePaymentWebhook(rawBody, signature);
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    if (event.kind === 'order') {
      const order = store.findOrderByRequestId(event.requestId);
      if (!order) return false;
      // Webhooks can repeat or arrive late; a finished order stays as it is.
      if (order.status === 'pending') store.updateOrder(order.id, { status: event.status === 'success' ? 'completed' : 'failed' });
      return true;
    }
    if (!store.recordTransfer(event.utr)) return true;
    const order = store.findPendingTransfer(event.virtualAccountNumber, event.amount);
    if (!order) {
      // Wrong amount or no open order: needs a person to match it up or refund it.
      console.warn(`Unmatched transfer ${event.utr}: ${formatInr(event.amount)} to ${event.virtualAccountNumber}`);
      return false;
    }
    store.updateOrder(order.id, { status: 'completed', utr: event.utr });
    return true;
  }

  const routes: Route[] = [
    ['GET', /^\/health$/, async () => json({ ok: true })],

    ['GET', /^\/config$/, async () => json({ sandbox: Boolean(sandbox) } satisfies ConfigResponse)],

    [
      'POST',
      /^\/auth\/otp$/,
      async (ctx) => {
        const mobile = requireMobile(field(parseJson(ctx.body), 'mobile'));
        try {
          await deps.otp.request(mobile);
        } catch (error) {
          if (error instanceof OtpTooSoonError) throw new HttpError(429, error.message);
          throw error;
        }
        const response: OtpResponse = { sent: true, devCode: sandbox?.otpSender.lastCodeFor(mobile) };
        return json(response);
      },
    ],

    [
      'POST',
      /^\/auth\/session$/,
      async (ctx) => {
        const body = parseJson(ctx.body);
        const mobile = requireMobile(field(body, 'mobile'));
        if (!deps.otp.verify(mobile, field(body, 'code'))) throw new HttpError(401, 'Wrong or expired code');
        const user = store.findOrCreateUser(mobile);
        const response: SessionResponse = { token: deps.sessions.create(user.id), me: await meView(user) };
        return json(response);
      },
    ],

    ['GET', /^\/me$/, async (ctx) => json(await meView(await signedInUser(ctx)))],

    [
      'POST',
      /^\/me\/verification$/,
      async (ctx) => json(await verification.start((await signedInUser(ctx)).id)),
    ],

    [
      'POST',
      /^\/webhooks\/penny-drop$/,
      async (ctx) => {
        try {
          await verification.handleWebhook(ctx.body, signatureOf(ctx));
        } catch (error) {
          throw new HttpError(400, (error as Error).message);
        }
        return json({ received: true });
      },
    ],

    [
      'POST',
      /^\/webhooks\/payments$/,
      async (ctx) => json({ received: true, matched: await handlePaymentWebhook(ctx.body, signatureOf(ctx)) }),
    ],

    [
      'GET',
      /^\/payees\/([^/]+)$/,
      async (ctx) => {
        const user = await signedInUser(ctx);
        if (!deps.payeeLookups.allow(user.id)) throw new HttpError(429, 'Too many lookups. Try again in an hour.');
        const mobile = requireMobile(ctx.params[0] ?? '');
        if (mobile === user.mobile) throw new HttpError(400, "That's your own number");
        const payee = store.getUserByMobile(mobile);
        const account = payee ? await accounts.getAccount(payee.id) : undefined;
        if (!payee || !account) throw new HttpError(404, 'No verified ePay user has this number');
        return json(payeeView(payee.id, account));
      },
    ],

    [
      'POST',
      /^\/payments\/plan$/,
      async (ctx) => {
        const { user } = await verifiedPayer(ctx);
        const body = parseJson(ctx.body);
        const { user: payeeUser } = await payeeById(field(body, 'payeeId'), user.id);
        return json(planFor(body, payeeUser));
      },
    ],

    [
      'POST',
      /^\/payments$/,
      async (ctx) => {
        const { user, payer } = await verifiedPayer(ctx);
        const body = parseJson(ctx.body);
        const { user: payeeUser, payee } = await payeeById(field(body, 'payeeId'), user.id);
        const method = field(body, 'method') as CollectionMethod;
        if (!COLLECTION_METHODS.includes(method)) throw new HttpError(400, `Unknown payment method ${method}`);
        const returnUrl = field(body, 'returnUrl');
        if (!deps.returnUrlPrefixes.some((prefix) => returnUrl.startsWith(prefix)) || returnUrl.length > 512) {
          throw new HttpError(400, 'returnUrl must be a link back into the app');
        }
        const plan = planFor(body, payeeUser);
        const orderId = newOrderId();
        const instruction = await startPayment({ orderId, payer, payee, plan, method, returnUrl }, deps);
        const order = store.createOrder({ id: orderId, payerId: user.id, payeeId: payee.id, amount: plan.amount, method, instruction });
        return json(await orderView(order), 201);
      },
    ],

    [
      'GET',
      /^\/payments$/,
      async (ctx) => {
        const user = await signedInUser(ctx);
        return json(await Promise.all(store.ordersForPayer(user.id, 20).map(orderView)));
      },
    ],

    ['GET', /^\/payments\/([^/]+)$/, async (ctx) => json(await orderView(await payersOrder(ctx)))],
  ];

  async function payersOrder(ctx: Context): Promise<Order> {
    const user = await signedInUser(ctx);
    const order = store.getOrder(ctx.params[0] ?? '');
    if (!order || order.payerId !== user.id) throw new HttpError(404, 'No such payment');
    return order;
  }

  if (sandbox) {
    routes.push(
      [
        'POST',
        /^\/sandbox\/penny-drop$/,
        async (ctx) => {
          const user = await signedInUser(ctx);
          const body = parseJson(ctx.body);
          const requestId = field(body, 'requestId');
          if ((await accounts.findCustomerForRequest(requestId)) !== user.id) throw new HttpError(404, 'No such verification');
          const typedName = typeof body.holderName === 'string' ? body.holderName.trim().slice(0, 60) : '';
          const webhook = sandbox.partner.simulatePennyDropWebhook(requestId, {
            accountNumber: `5010${user.mobile}`,
            ifsc: 'HDFC0001234',
            holderName: (typedName || `Sandbox User ${user.mobile.slice(-4)}`).toUpperCase(),
          });
          await verification.handleWebhook(webhook.rawBody, webhook.signature);
          return json(await meView(user));
        },
      ],
      [
        'POST',
        /^\/sandbox\/payments\/([^/]+)\/complete$/,
        async (ctx) => {
          const order = await payersOrder(ctx);
          const failed = parseJson(ctx.body).status === 'failed';
          const { instruction } = order;
          let event: PaymentEvent;
          if (instruction.method === 'bank_transfer') {
            if (failed) throw new HttpError(400, "A bank transfer either arrives or doesn't; it can't fail here");
            const utr = `SBXN${randomBytes(6).toString('hex').toUpperCase()}`;
            event = { kind: 'transfer', virtualAccountNumber: instruction.accountNumber, amount: order.amount, utr };
          } else {
            const requestId = instruction.method === 'enach' ? instruction.mandateId : instruction.requestId;
            event = { kind: 'order', requestId, status: failed ? 'failed' : 'success' };
          }
          const webhook = sandbox.partner.simulatePaymentWebhook(event);
          await handlePaymentWebhook(webhook.rawBody, webhook.signature);
          return json(await orderView(store.getOrder(order.id)!));
        },
      ],
      [
        'GET',
        /^\/sandbox\/bank\/([^/]+)$/,
        async (ctx) => {
          const requestId = ctx.params[0] ?? '';
          const order = store.findOrderByRequestId(requestId);
          const account = order ? await accounts.getAccount(order.payeeId) : undefined;
          if (!order || !account || !sandbox.partner.returnUrlFor(requestId)) throw new HttpError(404, 'No such bank request');
          const kind = order.method === 'enach' ? 'enach' : 'netbanking';
          return { status: 200, html: sandboxBankPage({ requestId, kind, payeeName: account.holderName, amountText: formatInr(order.amount) }) };
        },
      ],
      [
        'POST',
        /^\/sandbox\/bank\/([^/]+)$/,
        async (ctx) => {
          const requestId = ctx.params[0] ?? '';
          const returnUrl = sandbox.partner.returnUrlFor(requestId);
          if (!returnUrl) throw new HttpError(404, 'No such bank request');
          const approved = new URLSearchParams(ctx.body).get('decision') === 'approve';
          const webhook = sandbox.partner.simulatePaymentWebhook({ kind: 'order', requestId, status: approved ? 'success' : 'failed' });
          await handlePaymentWebhook(webhook.rawBody, webhook.signature);
          return { status: 303, location: returnUrl };
        },
      ],
    );
  }

  function planFor(body: Record<string, unknown>, payeeUser: User) {
    const amount = body.amount;
    if (typeof amount !== 'number') throw new HttpError(400, 'amount must be a number of paise');
    return planCollection({ amount, merchantCategory: payeeUser.merchantCategory, recurring: body.recurring === true });
  }

  return createServer(async (req, res) => {
    let reply: Reply;
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const match = matchRoute(routes, req.method ?? 'GET', url.pathname);
      if (!match) throw new HttpError(404, 'Not found');
      const body = await readBody(req);
      reply = await match.handler({ req, params: match.params, body });
    } catch (error) {
      reply = errorReply(error);
    }
    send(res, reply);
  });
}

function matchRoute(routes: Route[], method: string, pathname: string) {
  for (const [routeMethod, pattern, handler] of routes) {
    const found = pattern.exec(pathname);
    if (found && routeMethod === method) {
      return { handler, params: found.slice(1).map((part) => decodeURIComponent(part)) };
    }
  }
  return undefined;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(body: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(body || '{}');
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, 'Body must be a JSON object');
  return value as Record<string, unknown>;
}

function field(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== 'string' || !value) throw new HttpError(400, `${name} is required`);
  return value;
}

function requireMobile(input: string): string {
  const mobile = normalizeMobile(input);
  if (!mobile) throw new HttpError(400, 'Enter a 10-digit Indian mobile number');
  return mobile;
}

function signatureOf(ctx: Context): string {
  const signature = ctx.req.headers['x-signature'];
  if (typeof signature !== 'string') throw new HttpError(400, 'Missing X-Signature header');
  return signature;
}

function errorReply(error: unknown): Reply {
  if (error instanceof HttpError) return { status: error.status, json: { error: error.message } };
  if (error instanceof MethodUnavailableError || error instanceof RangeError) {
    return { status: 400, json: { error: error.message } };
  }
  console.error(error);
  return { status: 500, json: { error: 'Something went wrong' } };
}

function send(res: ServerResponse, reply: Reply): void {
  if ('location' in reply) {
    res.writeHead(303, { Location: reply.location }).end();
  } else if ('html' in reply) {
    res.writeHead(reply.status, { 'Content-Type': 'text/html; charset=utf-8' }).end(reply.html);
  } else {
    res.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply.json));
  }
}
