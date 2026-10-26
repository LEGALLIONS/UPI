import type { ReversePennyDropProvider, UpiPaymentRequest, VerifiedBankAccount } from './providers/types.ts';

export interface VerifiedAccountStore {
  savePendingRequest(requestId: string, customerId: string): Promise<void>;
  findCustomerForRequest(requestId: string): Promise<string | undefined>;
  saveAccount(customerId: string, account: VerifiedBankAccount): Promise<void>;
  getAccount(customerId: string): Promise<VerifiedBankAccount | undefined>;
}

/** Safe to show on screen or write to logs. */
export interface MaskedBankAccount {
  maskedAccountNumber: string;
  ifsc: string;
  holderName: string;
}

export type VerificationOutcome =
  | { customerId: string; verified: true; account: MaskedBankAccount }
  | { customerId: string; verified: false; reason: string };

export function maskAccount(account: VerifiedBankAccount): MaskedBankAccount {
  const lastFour = account.accountNumber.slice(-4);
  return {
    maskedAccountNumber: lastFour.padStart(account.accountNumber.length, 'X'),
    ifsc: account.ifsc,
    holderName: account.holderName,
  };
}

/**
 * Gets a customer's account number and IFSC without asking them to type it or
 * share any login: they pay ₹1 by UPI and the provider tells us where it came from.
 * Run this after the customer has signed in with their mobile number and OTP.
 */
export class AccountVerification {
  #provider: ReversePennyDropProvider;
  #store: VerifiedAccountStore;

  constructor(provider: ReversePennyDropProvider, store: VerifiedAccountStore) {
    this.#provider = provider;
    this.#store = store;
  }

  /** Returns the ₹1 UPI request to show the customer. */
  async start(customerId: string): Promise<UpiPaymentRequest> {
    const request = await this.#provider.createRequest({ referenceId: customerId });
    await this.#store.savePendingRequest(request.requestId, customerId);
    return request;
  }

  /**
   * Call from the webhook route with the raw request body. Safe to call again
   * for the same request, since providers retry webhooks.
   */
  async handleWebhook(rawBody: string, signature: string): Promise<VerificationOutcome> {
    const result = await this.#provider.parseWebhook(rawBody, signature);
    const customerId = await this.#store.findCustomerForRequest(result.requestId);
    if (!customerId) throw new Error(`No verification was started for request ${result.requestId}`);
    if (result.status === 'failed') return { customerId, verified: false, reason: result.reason };
    await this.#store.saveAccount(customerId, result.account);
    return { customerId, verified: true, account: maskAccount(result.account) };
  }
}
