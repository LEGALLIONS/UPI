import { randomUUID } from 'node:crypto';
import type { PaymentInstructions } from '../src/checkout.ts';
import type { UpiMerchantCategory } from '../src/limits.ts';
import type { Paise } from '../src/money.ts';
import type { UpiPaymentRequest } from '../src/providers/types.ts';
import type { OrderStatus } from './api-types.ts';

// In-memory storage, so the server runs with nothing else installed.
// Swap for a database before real users: everything here is lost on restart.

export interface User {
  id: string;
  mobile: string;
  /** Set after business verification (KYB), when NPCI allows the payee higher UPI limits. */
  merchantCategory?: UpiMerchantCategory;
}

export interface Order {
  id: string;
  payerId: string;
  payeeId: string;
  amount: Paise;
  fee: Paise;
  /** The fee request to show the payer now. */
  feeRequest: UpiPaymentRequest;
  /** Every fee request made for this order, so a late payment of an older one still counts. */
  feeRequestIds: string[];
  feeFailed: boolean;
  /** Worked out when the order is made; shown to the payer once the fee is paid. */
  instructions: PaymentInstructions;
  status: OrderStatus;
  utr: string | null;
  createdAt: Date;
}

export type OrderChanges = Partial<Pick<Order, 'status' | 'utr' | 'feeRequest' | 'feeFailed'>>;

export function newOrderId(): string {
  return `ord_${randomUUID()}`;
}

export class MemoryStore {
  #users = new Map<string, User>();
  #userIdsByMobile = new Map<string, string>();
  #orders = new Map<string, Order>();

  findOrCreateUser(mobile: string): User {
    const existing = this.#userIdsByMobile.get(mobile);
    if (existing) return this.#users.get(existing)!;
    const user: User = { id: `usr_${randomUUID()}`, mobile };
    this.#users.set(user.id, user);
    this.#userIdsByMobile.set(mobile, user.id);
    return user;
  }

  getUser(id: string): User | undefined {
    return this.#users.get(id);
  }

  getUserByMobile(mobile: string): User | undefined {
    const id = this.#userIdsByMobile.get(mobile);
    return id ? this.#users.get(id) : undefined;
  }

  createOrder(fields: Omit<Order, 'feeRequestIds' | 'feeFailed' | 'status' | 'utr' | 'createdAt'>): Order {
    const order: Order = {
      ...fields,
      feeRequestIds: [fields.feeRequest.requestId],
      feeFailed: false,
      status: 'awaiting_fee',
      utr: null,
      createdAt: new Date(),
    };
    this.#orders.set(order.id, order);
    return order;
  }

  updateOrder(id: string, changes: OrderChanges): Order {
    const order = this.#orders.get(id);
    if (!order) throw new Error(`No order ${id}`);
    const updated = { ...order, ...changes };
    if (changes.feeRequest) updated.feeRequestIds = [...order.feeRequestIds, changes.feeRequest.requestId];
    this.#orders.set(id, updated);
    return updated;
  }

  getOrder(id: string): Order | undefined {
    return this.#orders.get(id);
  }

  /** Payments this user sent or received, newest first. */
  ordersFor(userId: string, limit: number): Order[] {
    // Map keeps insertion order, so reversing gives newest first.
    return [...this.#orders.values()]
      .filter((order) => order.payerId === userId || order.payeeId === userId)
      .reverse()
      .slice(0, limit);
  }

  findOrderByFeeRequest(requestId: string): Order | undefined {
    return [...this.#orders.values()].find((order) => order.feeRequestIds.includes(requestId));
  }
}
