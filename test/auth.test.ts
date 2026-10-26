import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeMobile, OtpService, RateLimiter, SandboxOtpSender, Sessions } from '../server/auth.ts';

describe('normalizeMobile', () => {
  it('accepts the usual ways of writing an Indian mobile', () => {
    for (const input of ['9876543210', '+91 98765 43210', '+91-98765-43210', '09876543210', '919876543210']) {
      assert.equal(normalizeMobile(input), '9876543210', input);
    }
  });

  it('rejects landlines, short numbers and other countries', () => {
    for (const input of ['1234567890', '987654321', '+1 415 555 0100', 'abc']) {
      assert.equal(normalizeMobile(input), undefined, input);
    }
  });
});

describe('OtpService', () => {
  const setup = () => {
    let now = 0;
    const sender = new SandboxOtpSender();
    const otp = new OtpService(sender, () => now);
    return { otp, sender, advance: (ms: number) => (now += ms) };
  };

  it('accepts the right code once', async () => {
    const { otp, sender } = setup();
    await otp.request('9876543210');
    const code = sender.lastCodeFor('9876543210')!;
    assert.match(code, /^\d{6}$/);
    assert.equal(otp.verify('9876543210', code), true);
    assert.equal(otp.verify('9876543210', code), false);
  });

  it('expires codes after 5 minutes', async () => {
    const { otp, sender, advance } = setup();
    await otp.request('9876543210');
    advance(5 * 60 * 1000 + 1);
    assert.equal(otp.verify('9876543210', sender.lastCodeFor('9876543210')!), false);
  });

  it('stops after 5 wrong tries, even if the 6th is right', async () => {
    const { otp, sender } = setup();
    await otp.request('9876543210');
    for (let attempt = 0; attempt < 5; attempt++) otp.verify('9876543210', 'nope');
    assert.equal(otp.verify('9876543210', sender.lastCodeFor('9876543210')!), false);
  });

  it('makes you wait 30 seconds before resending', async () => {
    const { otp, advance } = setup();
    await otp.request('9876543210');
    await assert.rejects(otp.request('9876543210'), /30 seconds/);
    advance(30 * 1000);
    await otp.request('9876543210');
  });
});

describe('Sessions', () => {
  it('expires after 30 days', () => {
    let now = 0;
    const sessions = new Sessions(() => now);
    const token = sessions.create('usr_1');
    assert.equal(sessions.userFor(token), 'usr_1');
    now += 31 * 24 * 60 * 60 * 1000;
    assert.equal(sessions.userFor(token), undefined);
  });
});

describe('RateLimiter', () => {
  it('allows the limit per window, then resets', () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);
    assert.deepEqual([limiter.allow('a'), limiter.allow('a'), limiter.allow('a'), limiter.allow('b')], [true, true, false, true]);
    now += 1000;
    assert.equal(limiter.allow('a'), true);
  });
});
