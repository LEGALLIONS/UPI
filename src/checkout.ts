import type { VerifiedAccountStore } from './onboarding.ts';
import type { Customer, MandateProvider, PaymentGateway, VirtualAccountProvider } from './providers/types.ts';
import type { CollectionMethod, CollectionPlan, TransferRail } from './router.ts';

export type PaymentInstruction =
  | { method: 'upi'; requestId: string; upiIntent: string; expiresAt: Date }
  | { method: 'netbanking'; requestId: string; redirectUrl: string }
  | { method: 'bank_transfer'; accountNumber: string; ifsc: string; beneficiaryName: string; rails: TransferRail[] }
  | { method: 'enach'; mandateId: string; authUrl: string };

export interface CheckoutProviders {
  gateway: PaymentGateway;
  virtualAccounts: VirtualAccountProvider;
  mandates: MandateProvider;
  accounts: VerifiedAccountStore;
}

export interface StartPaymentInput {
  orderId: string;
  customer: Customer;
  /** From planCollection, for the same order. */
  plan: CollectionPlan;
  /** The option the customer picked. Must be one of plan.options. */
  method: CollectionMethod;
  /** Where the bank sends the customer back to after net banking or e-NACH approval. */
  returnUrl: string;
}

/** Turns the customer's chosen option into what to show them next. */
export async function startPayment(input: StartPaymentInput, providers: CheckoutProviders): Promise<PaymentInstruction> {
  const { orderId, customer, plan, method, returnUrl } = input;
  const option = plan.options.find((candidate) => candidate.method === method);
  if (!option) {
    const why = plan.unavailable.find((candidate) => candidate.method === method)?.reason ?? 'not offered for this payment';
    throw new Error(`Can't pay by ${method}: ${why}`);
  }
  const { amount } = plan;

  switch (option.method) {
    case 'upi': {
      const request = await providers.gateway.createUpiOrder({ orderId, amount, customer });
      return { method: 'upi', ...request };
    }
    case 'netbanking': {
      const order = await providers.gateway.createNetbankingOrder({ orderId, amount, customer, returnUrl });
      return { method: 'netbanking', ...order };
    }
    case 'bank_transfer': {
      const account = await providers.virtualAccounts.getOrCreate(customer);
      return { method: 'bank_transfer', ...account, rails: option.rails ?? [] };
    }
    case 'enach': {
      const account = await providers.accounts.getAccount(customer.id);
      if (!account) throw new Error(`Verify ${customer.id}'s bank account before setting up e-NACH`);
      const mandate = await providers.mandates.createEnachMandate({ customer, account, maxAmount: amount, returnUrl });
      return { method: 'enach', ...mandate };
    }
  }
}
