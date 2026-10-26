import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** "+91 98765-43210", "09876543210" or "9876543210" → "9876543210". undefined if not an Indian mobile. */
export function normalizeMobile(input: string): string | undefined {
  const digits = input.replace(/[\s()-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? digits : undefined;
}

export interface OtpSender {
  send(mobile: string, code: string): Promise<void>;
}

/** Keeps codes instead of sending SMS. Use an SMS provider (MSG91, Gupshup, Twilio...) in production. */
export class SandboxOtpSender implements OtpSender {
  #codes = new Map<string, string>();

  async send(mobile: string, code: string) {
    this.#codes.set(mobile, code);
  }

  lastCodeFor(mobile: string): string | undefined {
    return this.#codes.get(mobile);
  }
}

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_AFTER_MS = 30 * 1000;
const OTP_MAX_ATTEMPTS = 5;

interface PendingOtp {
  hash: Buffer;
  sentAt: number;
  attempts: number;
}

export class OtpTooSoonError extends Error {}

export class OtpService {
  #sender: OtpSender;
  #now: () => number;
  #pending = new Map<string, PendingOtp>();

  constructor(sender: OtpSender, now: () => number = Date.now) {
    this.#sender = sender;
    this.#now = now;
  }

  async request(mobile: string): Promise<void> {
    const previous = this.#pending.get(mobile);
    if (previous && this.#now() - previous.sentAt < OTP_RESEND_AFTER_MS) {
      throw new OtpTooSoonError('Wait 30 seconds before asking for another code');
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.#pending.set(mobile, { hash: hash(code), sentAt: this.#now(), attempts: 0 });
    await this.#sender.send(mobile, code);
  }

  /** Each code works once, for 5 minutes, with 5 tries. */
  verify(mobile: string, code: string): boolean {
    const pending = this.#pending.get(mobile);
    if (!pending) return false;
    if (this.#now() - pending.sentAt > OTP_TTL_MS || pending.attempts >= OTP_MAX_ATTEMPTS) {
      this.#pending.delete(mobile);
      return false;
    }
    if (timingSafeEqual(pending.hash, hash(code))) {
      this.#pending.delete(mobile);
      return true;
    }
    pending.attempts += 1;
    return false;
  }
}

function hash(code: string): Buffer {
  return createHash('sha256').update(code).digest();
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class Sessions {
  #now: () => number;
  #sessions = new Map<string, { userId: string; expiresAt: number }>();

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  create(userId: string): string {
    const token = randomBytes(32).toString('base64url');
    this.#sessions.set(token, { userId, expiresAt: this.#now() + SESSION_TTL_MS });
    return token;
  }

  userFor(token: string): string | undefined {
    const session = this.#sessions.get(token);
    if (!session) return undefined;
    if (session.expiresAt < this.#now()) {
      this.#sessions.delete(token);
      return undefined;
    }
    return session.userId;
  }
}

/** Fixed-window counter, e.g. to stop one user looking up thousands of mobile numbers. */
export class RateLimiter {
  #limit: number;
  #windowMs: number;
  #now: () => number;
  #windows = new Map<string, { startedAt: number; count: number }>();

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  allow(key: string): boolean {
    const now = this.#now();
    const window = this.#windows.get(key);
    if (!window || now - window.startedAt >= this.#windowMs) {
      this.#windows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= this.#limit;
  }
}
