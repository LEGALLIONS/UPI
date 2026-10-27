import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { MeView, SessionResponse, UpiPaymentRequest } from '../server/api-types.ts';
import { createApiServer, type ApiDeps } from '../server/app.ts';

/** Runs the API on a free port and talks to it over real HTTP, as the app does. */
export async function startApi(deps: ApiDeps) {
  const server = createApiServer(deps);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  async function call<T = unknown>(
    method: string,
    path: string,
    options: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
        ...(options.token && { Authorization: `Bearer ${options.token}` }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
    });
    return { status: response.status, body: (await response.json()) as T };
  }

  async function signIn(mobile: string): Promise<string> {
    const otp = await call<{ devCode: string }>('POST', '/auth/otp', { body: { mobile } });
    assert.equal(otp.status, 200);
    const session = await call<SessionResponse>('POST', '/auth/session', { body: { mobile, code: otp.body.devCode } });
    assert.equal(session.status, 200);
    return session.body.token;
  }

  /** The ₹1 UPI verification, with the sandbox standing in for the bank. */
  async function verify(token: string, holderName: string): Promise<MeView> {
    const request = await call<UpiPaymentRequest>('POST', '/me/verification', { token });
    assert.match(request.body.upiIntent, /^upi:\/\/pay\?/);
    const me = await call<MeView>('POST', '/sandbox/penny-drop', { token, body: { requestId: request.body.requestId, holderName } });
    assert.equal(me.status, 200);
    return me.body;
  }

  return { call, signIn, verify, close: () => server.close() };
}
