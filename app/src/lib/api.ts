import Constants from 'expo-constants';
import type {
  ConfigResponse,
  MeView,
  OrderView,
  OtpResponse,
  PayeeView,
  PaymentRequest,
  PlanRequest,
  PlanView,
  SessionResponse,
  UpiPaymentRequest,
} from '../../../server/api-types.ts';

export type * from '../../../server/api-types.ts';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? devServerUrl();

/** In development the API usually runs on the same computer as the Expo dev server. */
function devServerUrl(): string {
  const host = Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost';
  return `http://${host}:3000`;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API_URL + path, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, `Can't reach ePay at ${API_URL}. Check your internet connection.`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Something went wrong (${response.status})`);
  return data as T;
}

export function createApi(token: string | null) {
  return {
    config: () => request<ConfigResponse>('GET', '/config', null),
    requestOtp: (mobile: string) => request<OtpResponse>('POST', '/auth/otp', null, { mobile }),
    signIn: (mobile: string, code: string) => request<SessionResponse>('POST', '/auth/session', null, { mobile, code }),
    me: () => request<MeView>('GET', '/me', token),
    startVerification: () => request<UpiPaymentRequest>('POST', '/me/verification', token),
    /** Starts connecting the payer's current account through their bank's API, for one-approval payments. */
    linkBank: () => request<MeView>('POST', '/me/bank-link', token, {}),
    findPayee: (mobile: string) => request<PayeeView>('GET', `/payees/${encodeURIComponent(mobile)}`, token),
    plan: (body: PlanRequest) => request<PlanView>('POST', '/payments/plan', token, body),
    pay: (body: PaymentRequest) => request<OrderView>('POST', '/payments', token, body),
    payments: () => request<OrderView[]>('GET', '/payments', token),
    payment: (id: string) => request<OrderView>('GET', `/payments/${encodeURIComponent(id)}`, token),
    /** Asks the payer's bank to send whatever is left of this payment, for one approval. */
    bankPay: (id: string) => request<OrderView>('POST', `/payments/${encodeURIComponent(id)}/bank-pay`, token, {}),
    markSent: (id: string, utr: string) => request<OrderView>('POST', `/payments/${encodeURIComponent(id)}/sent`, token, { utr }),
    markReceived: (id: string) => request<OrderView>('POST', `/payments/${encodeURIComponent(id)}/received`, token, {}),
    markNotReceived: (id: string) =>
      request<OrderView>('POST', `/payments/${encodeURIComponent(id)}/not-received`, token, {}),
    sandbox: {
      pennyDrop: (requestId: string, holderName: string) =>
        request<MeView>('POST', '/sandbox/penny-drop', token, { requestId, holderName }),
      /** As if the payer approved or declined linking ePay in their bank. */
      bankLink: (outcome: 'approve' | 'decline') => request<MeView>('POST', '/sandbox/bank-link', token, { outcome }),
      /** As if the payer's bank sent (or didn't send) the parts it was asked to. */
      bank: (orderId: string, outcome: 'approve' | 'decline' | 'commission_fails') =>
        request<OrderView>('POST', `/sandbox/payments/${encodeURIComponent(orderId)}/bank`, token, { outcome }),
      /** As if ePay's bank reported the commission arriving. */
      payCommission: (orderId: string) =>
        request<OrderView>('POST', `/sandbox/payments/${encodeURIComponent(orderId)}/commission`, token, {}),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
