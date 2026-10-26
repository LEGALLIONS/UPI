import { randomUUID } from 'node:crypto';
import type { PaymentInstruction } from '../src/checkout.ts';
import type { UpiMerchantCategory } from '../src/limits.ts';
import type { Paise } from '../src/money.ts';
import type { CollectionMethod } from '../src/router.ts';
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
  method: CollectionMethod;
  instruction: PaymentInstruction;
  status: OrderStatus;
  utr: string | null;
  createdAt: Date;
}

export function newOrderId(): string {
  return `ord_${randomUUID()}`;
}

export class MemoryStore {
  #users = new Map<string, User>();
  #userIdsByMobile = new Map<string, string>();
  #orders = new Map<string, Order>();
  #transferUtrs = new Set<string>();

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

  createOrder(fields: Omit<Order, 'status' | 'utr' | 'createdAt'>): Order {
    const order: Order = { ...fields, status: 'pending', utr: null, createdAt: new Date() };
    this.#orders.set(order.id, order);
    return order;
  }

  updateOrder(id: string, changes: Pick<Order, 'status'> & Partial<Pick<Order, 'utr'>>): void {
    const order = this.#orders.get(id);
    if (!order) throw new Error(`No order ${id}`);
    this.#orders.set(id, { ...order, ...changes });
  }

  /** False if this bank reference was seen before, so a repeated webhook can't pay a second order. */
  recordTransfer(utr: string): boolean {
    if (this.#transferUtrs.has(utr)) return false;
    this.#transferUtrs.add(utr);
    return true;
  }

  getOrder(id: string): Order | undefined {
    return this.#orders.get(id);
  }

  ordersForPayer(payerId: string, limit: number): Order[] {
    // Map keeps insertion order, so reversing gives newest first.
    return [...this.#orders.values()]
      .filter((order) => order.payerId === payerId)
      .reverse()
      .slice(0, limit);
  }

  /** The order a UPI, net banking or e-NACH event refers to. */
  findOrderByRequestId(requestId: string): Order | undefined {
    return [...this.#orders.values()].find((order) => requestIdOf(order.instruction) === requestId);
  }

  /** The oldest pending transfer to this virtual account for exactly this amount. */
  findPendingTransfer(virtualAccountNumber: string, amount: Paise): Order | undefined {
    return [...this.#orders.values()].find(
      (order) =>
        order.status === 'pending' &&
        order.instruction.method === 'bank_transfer' &&
        order.instruction.accountNumber === virtualAccountNumber &&
        order.amount === amount,
    );
  }
}

function requestIdOf(instruction: PaymentInstruction): string | undefined {
  switch (instruction.method) {
    case 'upi':
    case 'netbanking':
      return instruction.requestId;
    case 'enach':
      return instruction.mandateId;
    case 'bank_transfer':
      return undefined;
  }
}
