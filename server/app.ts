import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { paymentInstructions } from '../src/checkout.ts';
import { DEFAULT_FEE_POLICY, feeFor, feePercent, type FeePolicy } from '../src/fees.ts';
import { DEFAULT_LIMITS } from '../src/limits.ts';
import { formatInr } from '../src/money.ts';
import { AccountVerification, maskAccount, type VerifiedAccountStore } from '../src/onboarding.ts';
import { InMemoryAccountStore, SandboxPartner } from '../src/providers/sandbox.ts';
import type {
  Customer,
  Payee,
  PaymentEvent,
  PaymentGateway,
  ReversePennyDropProvider,
  VerifiedBankAccount,
} from '../src/providers/types.ts';
import { planCollection } from '../src/router.ts';
import type { ConfigResponse, MeView, OrderStatus, OrderView, OtpResponse, PayeeView, PlanView, SessionResponse } from './api-types.ts';
import { normalizeMobile, OtpService, OtpTooSoonError, RateLimiter, SandboxOtpSender, Sessions } from './auth.ts';
import { MemoryStore, newOrderId, type Order, type OrderChanges, type User } from './store.ts';

export interface ApiDeps {
  pennyDrop: ReversePennyDropProvider;
  /** Collects ePay's fee into ePay's own account. Payments themselves never pass through it. */
  gateway: PaymentGateway;
  accounts: VerifiedAccountStore;
  store: MemoryStore;
  otp: OtpService;
  sessions: Sessions;
  payeeLookups: RateLimiter;
  feePolicy: FeePolicy;
  /** Present only in sandbox mode: enables the /sandbox routes that simulate each step. */
  sandbox?: { partner: SandboxPartner; otpSender: SandboxOtpSender };
}

export function createSandboxDeps(options: { webhookSecret?: string } = {}) {
  const partner = new SandboxPartner({
    webhookSecret: options.webhookSecret ?? randomBytes(32).toString('hex'),
    merchantVpa: 'epay@sandbox',
    merchantName: 'ePay',
  });
  const otpSender = new SandboxOtpSender();
  return {
    pennyDrop: partner,
    gateway: partner,
    accounts: new InMemoryAccountStore(),
    store: new MemoryStore(),
    otp: new OtpService(otpSender),
    sessions: new Sessions(),
    payeeLookups: new RateLimiter(30, 60 * 60 * 1000),
    feePolicy: DEFAULT_FEE_POLICY,
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

type Reply = { status: number; json: unknown };

interface Context {
  req: IncomingMessage;
  params: string[];
  body: string;
}

type Route = [method: string, path: RegExp, handler: (ctx: Context) => Promise<Reply>];

const MAX_BODY_BYTES = 64 * 1024;
/** UPI and IMPS references are 12 digits; NEFT and RTGS UTRs are 16 or 22 letters and digits. */
const UTR = /^[A-Z0-9]{12,22}$/;

const STATUS_WORDS: Record<OrderStatus, string> = {
  awaiting_fee: 'waiting for the ePay fee',
  awaiting_transfer: 'waiting for the money to be sent',
  sent: 'marked as sent',
  received: 'confirmed as received',
  not_received: 'marked as not received',
};

export function createApiServer(deps: ApiDeps): Server {
  const { store, accounts, sandbox, feePolicy } = deps;
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
    return { id: user.id, mobile: user.mobile, account: account ? maskAccount(account) : null, upiId: account?.vpa ?? null };
  }

  function payeeView(id: string, account: VerifiedBankAccount): PayeeView {
    const masked = maskAccount(account);
    return { id, name: account.holderName, maskedAccountNumber: masked.maskedAccountNumber, ifsc: account.ifsc };
  }

  async function orderView(order: Order, viewerId: string): Promise<OrderView> {
    const [payerAccount, payeeAccount] = await Promise.all([accounts.getAccount(order.payerId), accounts.getAccount(order.payeeId)]);
    if (!payerAccount || !payeeAccount) throw new Error(`A party to ${order.id} has no verified account`);
    const role = viewerId === order.payerId ? 'payer' : 'payee';
    const feePaid = order.status !== 'awaiting_fee';
    return {
      id: order.id,
      role,
      payer: { id: order.payerId, name: payerAccount.holderName },
      payee: payeeView(order.payeeId, payeeAccount),
      amount: order.amount,
      fee: order.fee,
      status: order.status,
      feeRequest: role === 'payer' && !feePaid ? order.feeRequest : null,
      feeFailed: order.feeFailed,
      instructions: role === 'payer' && feePaid ? order.instructions : null,
      reference: order.instructions.reference,
      utr: order.utr,
      createdAt: order.createdAt.toISOString(),
    };
  }

  function planFor(body: Record<string, unknown>, payee: Payee, payeeUser: User): PlanView {
    const amount = body.amount;
    if (typeof amount !== 'number') throw new HttpError(400, 'amount must be a number of paise');
    const plan = planCollection({ amount, merchantCategory: payeeUser.merchantCategory, payeeHasUpi: Boolean(payee.account.vpa) });
    const fee = feeFor(amount, feePolicy);
    // The fee is paid by UPI to ePay, so it has to fit within one UPI payment.
    if (fee > DEFAULT_LIMITS.upiDefault.perTxn) {
      throw new HttpError(400, `ePay's fee on this amount would be over the ${formatInr(DEFAULT_LIMITS.upiDefault.perTxn)} UPI limit`);
    }
    return { ...plan, fee, feePercent: feePercent(feePolicy) };
  }

  /** The order, if the signed-in user paid or is being paid in it. */
  async function partyOrder(ctx: Context): Promise<{ user: User; order: Order }> {
    const user = await signedInUser(ctx);
    const order = store.getOrder(ctx.params[0] ?? '');
    if (!order || (order.payerId !== user.id && order.payeeId !== user.id)) throw new HttpError(404, 'No such payment');
    return { user, order };
  }

  /** Moves an order on, if the user is on the right side of it and it's at an allowed step. */
  async function transition(
    ctx: Context,
    role: 'payer' | 'payee',
    from: OrderStatus[],
    changes: (order: Order) => OrderChanges | Promise<OrderChanges>,
  ): Promise<Reply> {
    const { user, order } = await partyOrder(ctx);
    const isPayer = order.payerId === user.id;
    if ((role === 'payer') !== isPayer) throw new HttpError(403, `Only the ${role} can do that`);
    if (!from.includes(order.status)) throw new HttpError(409, `This payment is ${STATUS_WORDS[order.status]}`);
    return json(await orderView(store.updateOrder(order.id, await changes(order)), user.id));
  }

  async function handlePaymentWebhook(rawBody: string, signature: string): Promise<boolean> {
    let event: PaymentEvent;
    try {
      event = await deps.gateway.parsePaymentWebhook(rawBody, signature);
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    const order = store.findOrderByFeeRequest(event.requestId);
    if (!order) return false;
    if (event.status === 'success') {
      if (order.status === 'awaiting_fee') store.updateOrder(order.id, { status: 'awaiting_transfer', feeFailed: false });
      else console.warn(`Fee for ${order.id} paid twice (${event.requestId}): refund one`);
    } else if (order.status === 'awaiting_fee' && order.feeRequest.requestId === event.requestId) {
      store.updateOrder(order.id, { feeFailed: true });
    }
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

    ['POST', /^\/me\/verification$/, async (ctx) => json(await verification.start((await signedInUser(ctx)).id))],

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
        const { user: payeeUser, payee } = await payeeById(field(body, 'payeeId'), user.id);
        return json(planFor(body, payee, payeeUser));
      },
    ],

    [
      'POST',
      /^\/payments$/,
      async (ctx) => {
        const { user, payer } = await verifiedPayer(ctx);
        const body = parseJson(ctx.body);
        const { user: payeeUser, payee } = await payeeById(field(body, 'payeeId'), user.id);
        const plan = planFor(body, payee, payeeUser);
        const id = newOrderId();
        const feeRequest = await deps.gateway.createUpiOrder({ orderId: id, amount: plan.fee, payer });
        const order = store.createOrder({
          id,
          payerId: user.id,
          payeeId: payee.id,
          amount: plan.amount,
          fee: plan.fee,
          feeRequest,
          instructions: paymentInstructions({ orderId: id, payee, plan }),
        });
        return json(await orderView(order, user.id), 201);
      },
    ],

    [
      'GET',
      /^\/payments$/,
      async (ctx) => {
        const user = await signedInUser(ctx);
        return json(await Promise.all(store.ordersFor(user.id, 20).map((order) => orderView(order, user.id))));
      },
    ],

    [
      'GET',
      /^\/payments\/([^/]+)$/,
      async (ctx) => {
        const { user, order } = await partyOrder(ctx);
        return json(await orderView(order, user.id));
      },
    ],

    [
      'POST',
      /^\/payments\/([^/]+)\/fee$/,
      async (ctx) =>
        transition(ctx, 'payer', ['awaiting_fee'], async (order) => {
          const account = (await accounts.getAccount(order.payerId))!;
          const payer = { id: order.payerId, name: account.holderName, mobile: store.getUser(order.payerId)!.mobile };
          const feeRequest = await deps.gateway.createUpiOrder({ orderId: order.id, amount: order.fee, payer });
          return { feeRequest, feeFailed: false };
        }),
    ],

    [
      'POST',
      /^\/payments\/([^/]+)\/sent$/,
      async (ctx) => {
        const utr = field(parseJson(ctx.body), 'utr').replace(/\s/g, '').toUpperCase();
        if (!UTR.test(utr)) throw new HttpError(400, 'Enter the reference exactly as your bank shows it: 12 to 22 letters and numbers');
        return transition(ctx, 'payer', ['awaiting_transfer', 'not_received'], () => ({ status: 'sent', utr }));
      },
    ],

    [
      'POST',
      /^\/payments\/([^/]+)\/received$/,
      async (ctx) => transition(ctx, 'payee', ['sent', 'not_received'], () => ({ status: 'received' })),
    ],

    [
      'POST',
      /^\/payments\/([^/]+)\/not-received$/,
      async (ctx) => transition(ctx, 'payee', ['sent'], () => ({ status: 'not_received' })),
    ],
  ];

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
            vpa: `${user.mobile}@sandbox`,
          });
          await verification.handleWebhook(webhook.rawBody, webhook.signature);
          return json(await meView(user));
        },
      ],
      [
        'POST',
        /^\/sandbox\/payments\/([^/]+)\/fee$/,
        async (ctx) => {
          const { user, order } = await partyOrder(ctx);
          if (order.payerId !== user.id) throw new HttpError(403, 'Only the payer can do that');
          const status = parseJson(ctx.body).status === 'failed' ? 'failed' : 'success';
          const webhook = sandbox.partner.simulatePaymentWebhook({ requestId: order.feeRequest.requestId, status });
          await handlePaymentWebhook(webhook.rawBody, webhook.signature);
          return json(await orderView(store.getOrder(order.id)!, user.id));
        },
      ],
    );
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
  if (error instanceof RangeError) return { status: 400, json: { error: error.message } };
  console.error(error);
  return { status: 500, json: { error: 'Something went wrong' } };
}

function send(res: ServerResponse, reply: Reply): void {
  res.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply.json));
}
