import { randomUUID } from 'node:crypto';
import type { PaymentInstructions } from '../src/checkout.ts';
import type { UpiMerchantCategory } from '../src/limits.ts';
import type { Paise } from '../src/money.ts';
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
  commissionPaid: boolean;
  /** The bank's reference for the commission, once it's known. */
  commissionUtr: string | null;
  /** Where the payer sends the amount, and then the commission, worked out when the order is made. */
  instructions: PaymentInstructions;
  status: OrderStatus;
  /** The payer says the money didn't go. ePay checks, then waives the commission or keeps it due. */
  complaint: Complaint | null;
  createdAt: Date;
}

export interface Complaint {
  note: string;
  raisedAt: Date;
  status: 'open' | 'waived' | 'rejected';
}

export type OrderChanges = Partial<Pick<Order, 'status' | 'commissionPaid' | 'commissionUtr' | 'complaint'>>;

export function newOrderId(): string {
  return `ord_${randomUUID()}`;
}

export class MemoryStore {
  #users = new Map<string, User>();
  #userIdsByMobile = new Map<string, string>();
  #orders = new Map<string, Order>();
  #creditUtrs = new Set<string>();

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

  createOrder(fields: Omit<Order, 'commissionPaid' | 'commissionUtr' | 'status' | 'complaint' | 'createdAt'>): Order {
    const order: Order = {
      ...fields,
      commissionPaid: false,
      commissionUtr: null,
      status: 'awaiting_transfer',
      complaint: null,
      createdAt: new Date(),
    };
    this.#orders.set(order.id, order);
    return order;
  }

  updateOrder(id: string, changes: OrderChanges): Order {
    const order = this.#orders.get(id);
    if (!order) throw new Error(`No order ${id}`);
    const updated = { ...order, ...changes };
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

  findOrderByReference(reference: string): Order | undefined {
    return [...this.#orders.values()].find((order) => order.instructions.reference === reference);
  }

  /**
   * Payments this payer has sent without ePay's commission arriving: their next
   * payment waits on these, unless ePay waived the commission after a complaint.
   */
  unpaidCommissions(payerId: string): Order[] {
    return [...this.#orders.values()].filter(
      (order) =>
        order.payerId === payerId && order.status === 'sent' && !order.commissionPaid && order.complaint?.status !== 'waived',
    );
  }

  /** Complaints waiting for ePay to check, oldest first. */
  openComplaints(): Order[] {
    return [...this.#orders.values()].filter((order) => order.complaint?.status === 'open');
  }

  /** False if this bank reference was seen before, so a repeated credit notice is counted once. */
  recordCredit(utr: string): boolean {
    if (this.#creditUtrs.has(utr)) return false;
    this.#creditUtrs.add(utr);
    return true;
  }
}
