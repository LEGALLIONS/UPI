import { randomBytes, randomInt } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { bankName } from '../src/banks.ts';
import { findReference, paymentInstructions, referenceFor, splitLegs, type PaymentInstructions } from '../src/checkout.ts';
import { DEFAULT_FEE_POLICY, feeFor, feePercent, type FeePolicy } from '../src/fees.ts';
import { formatInr } from '../src/money.ts';
import { AccountVerification, maskAccount, type VerifiedAccountStore } from '../src/onboarding.ts';
import { InMemoryAccountStore, SandboxPartner } from '../src/providers/sandbox.ts';
import type {
  BankEvent,
  CommissionAccount,
  ConnectedBanking,
  CreditEvent,
  CreditNotifications,
  Payee,
  ReversePennyDropProvider,
  SplitLeg,
  VerifiedBankAccount,
} from '../src/providers/types.ts';
import { planCollection } from '../src/router.ts';
import type {
  ConfigResponse,
  MeView,
  OrderStatus,
  OrderView,
  OtpResponse,
  PayeeView,
  PayerInstructions,
  PlanView,
  SessionResponse,
} from './api-types.ts';
import { normalizeMobile, OtpService, OtpTooSoonError, RateLimiter, SandboxOtpSender, Sessions } from './auth.ts';
import { MemoryStore, newOrderId, type Order, type OrderChanges, type User } from './store.ts';

export interface ApiDeps {
  pennyDrop: ReversePennyDropProvider;
  /** ePay's own account, where payers send the commission alongside each payment. */
  commissionAccount: CommissionAccount;
  /** ePay's bank reporting money arriving in that account. */
  credits: CreditNotifications;
  /** Payers' banks, for sending both parts with one approval. */
  banking: ConnectedBanking;
  accounts: VerifiedAccountStore;
  store: MemoryStore;
  otp: OtpService;
  sessions: Sessions;
  payeeLookups: RateLimiter;
  feePolicy: FeePolicy;
  /** Present only in sandbox mode: enables the /sandbox routes that simulate each step. */
  sandbox?: { partner: SandboxPartner; otpSender: SandboxOtpSender };
}

export const SANDBOX_COMMISSION_ACCOUNT: CommissionAccount = {
  accountNumber: '777705550001',
  ifsc: 'SBXN0000001',
  name: 'EPAY TECHNOLOGIES',
  upiId: 'epay@sandbox',
};

export function createSandboxDeps(
  options: { webhookSecret?: string; commissionAccount?: CommissionAccount; connectedBanks?: string[] } = {},
) {
  const partner = new SandboxPartner({
    webhookSecret: options.webhookSecret ?? randomBytes(32).toString('hex'),
    merchantVpa: 'epayverify@sandbox',
    merchantName: 'ePay',
    connectedBanks: options.connectedBanks,
  });
  const otpSender = new SandboxOtpSender();
  return {
    pennyDrop: partner,
    commissionAccount: options.commissionAccount ?? SANDBOX_COMMISSION_ACCOUNT,
    credits: partner,
    banking: partner,
    accounts: new InMemoryAccountStore(),
    store: new MemoryStore(),
    otp: new OtpService(otpSender),
    sessions: new Sessions(),
    payeeLookups: new RateLimiter(30, 60 * 60 * 1000),
    feePolicy: DEFAULT_FEE_POLICY,
    sandbox: { partner, otpSender },
  } satisfies ApiDeps;
}

/** Leaves ePay's account details out of what the payer's app gets: the commission is just an amount and a UPI link. */
function payerInstructions({ reference, payment, commission }: PaymentInstructions): PayerInstructions {
  return { reference, payment, commission: { amount: commission.amount, upiIntent: commission.upiIntent } };
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

  async function verifiedPayer(ctx: Context): Promise<User> {
    const user = await signedInUser(ctx);
    if (!(await accounts.getAccount(user.id))) throw new HttpError(403, 'Verify your bank account first');
    return user;
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
    return {
      id: user.id,
      mobile: user.mobile,
      account: account ? maskAccount(account) : null,
      upiId: account?.vpa ?? null,
      bankName: account ? bankName(account.ifsc) : null,
      oneApproval: !account || !deps.banking.supports(account.ifsc) ? 'unsupported' : (user.bankLink?.status ?? 'not_linked'),
    };
  }

  /** What's still to send. The amount only before it was ever sent: resending it could pay twice. */
  function unsentParts(order: Order): SplitLeg['part'][] {
    return [
      ...(order.status === 'awaiting_transfer' ? (['payment'] as const) : []),
      ...(order.commissionPaid ? [] : (['commission'] as const)),
    ];
  }

  function payeeView(id: string, account: VerifiedBankAccount): PayeeView {
    const masked = maskAccount(account);
    return { id, name: account.holderName, maskedAccountNumber: masked.maskedAccountNumber, ifsc: account.ifsc };
  }

  async function orderView(order: Order, viewerId: string): Promise<OrderView> {
    const [payerAccount, payeeAccount] = await Promise.all([accounts.getAccount(order.payerId), accounts.getAccount(order.payeeId)]);
    if (!payerAccount || !payeeAccount) throw new Error(`A party to ${order.id} has no verified account`);
    const role = viewerId === order.payerId ? 'payer' : 'payee';
    const payerLinked = store.getUser(order.payerId)?.bankLink?.status === 'linked';
    const { bankRequest } = order;
    return {
      id: order.id,
      role,
      payer: { id: order.payerId, name: payerAccount.holderName },
      payee: payeeView(order.payeeId, payeeAccount),
      amount: order.amount,
      fee: order.fee,
      status: order.status,
      commissionPaid: role === 'payer' ? order.commissionPaid : null,
      instructions: role === 'payer' ? payerInstructions(order.instructions) : null,
      oneApproval: role === 'payer' && payerLinked && bankRequest?.status !== 'pending' && unsentParts(order).length > 0,
      bankRequest:
        role === 'payer' && bankRequest
          ? { status: bankRequest.status, parts: bankRequest.parts, failedParts: bankRequest.failedParts }
          : null,
      reference: order.instructions.reference,
      utr: order.utr,
      createdAt: order.createdAt.toISOString(),
    };
  }

  function planFor(body: Record<string, unknown>, payee: Payee, payeeUser: User): PlanView {
    const amount = body.amount;
    if (typeof amount !== 'number') throw new HttpError(400, 'amount must be a number of paise');
    const plan = planCollection({ amount, merchantCategory: payeeUser.merchantCategory, payeeHasUpi: Boolean(payee.account.vpa) });
    return { ...plan, fee: feeFor(amount, feePolicy), feePercent: feePercent(feePolicy), gstIncluded: feePolicy.gstIncluded };
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

  /** Matches money arriving in ePay's account to a payment's commission, by the reference in its remarks. */
  async function handleCreditWebhook(rawBody: string, signature: string): Promise<'matched' | 'unmatched' | 'duplicate'> {
    let credit: CreditEvent;
    try {
      credit = await deps.credits.parseCreditWebhook(rawBody, signature);
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    if (!store.recordCredit(credit.utr)) return 'duplicate';
    const reference = findReference(credit.remarks);
    const order = reference ? store.findOrderByReference(reference) : undefined;
    if (!order || credit.amount < order.fee) {
      // No reference, or too little: needs a person to match it up or refund it.
      console.warn(`Unmatched credit ${credit.utr}: ${formatInr(credit.amount)}, remarks "${credit.remarks}"`);
      return 'unmatched';
    }
    // The payer's bank may already have reported this same transfer.
    if (order.commissionUtr === credit.utr) return 'duplicate';
    if (order.commissionPaid) console.warn(`Commission for ${order.id} paid again (${credit.utr}): refund it`);
    else store.updateOrder(order.id, { commissionPaid: true, commissionUtr: credit.utr });
    return 'matched';
  }

  /** The payer's bank reporting a link approved or declined, or how each part of a payment went. */
  async function handleBankWebhook(rawBody: string, signature: string): Promise<void> {
    let event: BankEvent;
    try {
      event = await deps.banking.parseBankWebhook(rawBody, signature);
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    if (event.kind === 'link') {
      const user = store.findUserByLinkId(event.linkId);
      if (user?.bankLink) {
        store.updateUser(user.id, { bankLink: { ...user.bankLink, status: event.status === 'approved' ? 'linked' : 'declined' } });
      }
      return;
    }
    const order = store.findOrderByBankRequest(event.requestId);
    // Unknown, or a repeat of a result already applied.
    if (!order?.bankRequest || order.bankRequest.status !== 'pending') return;
    const changes: OrderChanges = {};
    const failedParts: SplitLeg['part'][] = [];
    for (const leg of event.legs) {
      if (leg.status === 'failed' || !leg.utr) {
        failedParts.push(leg.part);
      } else if (leg.part === 'payment') {
        Object.assign(changes, { status: 'sent', utr: leg.utr });
      } else {
        Object.assign(changes, { commissionPaid: true, commissionUtr: leg.utr });
      }
    }
    store.updateOrder(order.id, {
      ...changes,
      bankRequest: { ...order.bankRequest, status: failedParts.length ? 'failed' : 'done', failedParts },
    });
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
      /^\/me\/bank-link$/,
      async (ctx) => {
        const user = await signedInUser(ctx);
        const account = await accounts.getAccount(user.id);
        if (!account) throw new HttpError(403, 'Verify your bank account first');
        if (!deps.banking.supports(account.ifsc)) {
          throw new HttpError(400, `ePay can't connect to ${bankName(account.ifsc) ?? 'your bank'} yet. Send the two transfers yourself.`);
        }
        if (user.bankLink?.status === 'linked' || user.bankLink?.status === 'pending') return json(await meView(user));
        const { linkId } = await deps.banking.startLink({ customerId: user.id, account });
        return json(await meView(store.updateUser(user.id, { bankLink: { linkId, status: 'pending' } })));
      },
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
      /^\/webhooks\/commission$/,
      async (ctx) => json({ received: true, result: await handleCreditWebhook(ctx.body, signatureOf(ctx)) }),
    ],

    [
      'POST',
      /^\/webhooks\/bank$/,
      async (ctx) => {
        await handleBankWebhook(ctx.body, signatureOf(ctx));
        return json({ received: true });
      },
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
        const user = await verifiedPayer(ctx);
        const body = parseJson(ctx.body);
        const { user: payeeUser, payee } = await payeeById(field(body, 'payeeId'), user.id);
        return json(planFor(body, payee, payeeUser));
      },
    ],

    [
      'POST',
      /^\/payments$/,
      async (ctx) => {
        const user = await verifiedPayer(ctx);
        const owed = store.unpaidCommissions(user.id)[0];
        if (owed) {
          throw new HttpError(
            409,
            `ePay hasn't received the commission for your payment ${owed.instructions.reference} yet. You can start a new payment once it arrives.`,
          );
        }
        const body = parseJson(ctx.body);
        const { user: payeeUser, payee } = await payeeById(field(body, 'payeeId'), user.id);
        const plan = planFor(body, payee, payeeUser);
        let id = newOrderId();
        // References are short, so make sure this one isn't already taken.
        while (store.findOrderByReference(referenceFor(id))) id = newOrderId();
        const order = store.createOrder({
          id,
          payerId: user.id,
          payeeId: payee.id,
          amount: plan.amount,
          fee: plan.fee,
          instructions: paymentInstructions({ orderId: id, payee, plan, fee: plan.fee, commissionAccount: deps.commissionAccount }),
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
      /^\/payments\/([^/]+)\/sent$/,
      async (ctx) => {
        const utr = field(parseJson(ctx.body), 'utr').replace(/\s/g, '').toUpperCase();
        if (!UTR.test(utr)) throw new HttpError(400, 'Enter the reference exactly as your bank shows it: 12 to 22 letters and numbers');
        return transition(ctx, 'payer', ['awaiting_transfer', 'not_received'], (order) => {
          if (order.bankRequest?.status === 'pending') throw new HttpError(409, 'Your bank is still working on this payment');
          return { status: 'sent', utr };
        });
      },
    ],

    [
      'POST',
      /^\/payments\/([^/]+)\/bank-pay$/,
      async (ctx) => {
        const { user, order } = await partyOrder(ctx);
        if (order.payerId !== user.id) throw new HttpError(403, 'Only the payer can do that');
        const linkId = user.bankLink?.status === 'linked' ? user.bankLink.linkId : undefined;
        if (!linkId) throw new HttpError(409, 'Link your bank account first');
        if (order.bankRequest?.status === 'pending') throw new HttpError(409, 'Your bank is still working on this payment');
        const parts = unsentParts(order);
        if (parts.length === 0) throw new HttpError(409, 'Nothing is left to send');
        const { requestId } = await deps.banking.requestSplitPayment({ linkId, legs: splitLegs(order.instructions, parts) });
        const updated = store.updateOrder(order.id, { bankRequest: { requestId, parts, status: 'pending', failedParts: [] } });
        return json(await orderView(updated, user.id));
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
        /^\/sandbox\/payments\/([^/]+)\/commission$/,
        async (ctx) => {
          const { user, order } = await partyOrder(ctx);
          if (order.payerId !== user.id) throw new HttpError(403, 'Only the payer can do that');
          const remarks = parseJson(ctx.body).remarks;
          const webhook = sandbox.partner.simulateCreditWebhook({
            amount: order.fee,
            utr: String(randomInt(1e11, 1e12)),
            remarks: typeof remarks === 'string' ? remarks : order.instructions.reference,
          });
          await handleCreditWebhook(webhook.rawBody, webhook.signature);
          return json(await orderView(store.getOrder(order.id)!, user.id));
        },
      ],
      [
        'POST',
        /^\/sandbox\/bank-link$/,
        async (ctx) => {
          const user = await signedInUser(ctx);
          if (user.bankLink?.status !== 'pending') throw new HttpError(409, 'No bank link is waiting for approval');
          const status = parseJson(ctx.body).outcome === 'decline' ? 'declined' : 'approved';
          const webhook = sandbox.partner.simulateBankWebhook({ kind: 'link', linkId: user.bankLink.linkId, status });
          await handleBankWebhook(webhook.rawBody, webhook.signature);
          return json(await meView(store.getUser(user.id)!));
        },
      ],
      [
        'POST',
        /^\/sandbox\/payments\/([^/]+)\/bank$/,
        async (ctx) => {
          const { user, order } = await partyOrder(ctx);
          if (order.payerId !== user.id) throw new HttpError(403, 'Only the payer can do that');
          if (order.bankRequest?.status !== 'pending') throw new HttpError(409, 'No bank request is waiting for approval');
          const outcome = parseJson(ctx.body).outcome;
          const legs = order.bankRequest.parts.map((part) => {
            const failed = outcome === 'decline' || (outcome === 'commission_fails' && part === 'commission');
            return { part, status: failed ? ('failed' as const) : ('success' as const), utr: failed ? null : String(randomInt(1e11, 1e12)) };
          });
          const webhook = sandbox.partner.simulateBankWebhook({ kind: 'split', requestId: order.bankRequest.requestId, legs });
          await handleBankWebhook(webhook.rawBody, webhook.signature);
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
