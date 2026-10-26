# UPI for high-value business payments

UPI stops at ₹1 lakh a day for most payments. Businesses often need to move far more. This project keeps the UPI experience where it works, and above the limit sends the payment to net banking, bank transfer or e-NACH, which have no UPI cap.

It never asks for net banking passwords, and never needs the customer to type an account number. Account details come from the bank itself, through a ₹1 UPI payment.

## How it works

1. **Sign in** with mobile number and OTP (use your own SMS provider).
2. **Verify the bank account** with a *reverse penny drop*. The customer pays ₹1 from any UPI app, and the provider reports the account number, IFSC and name it came from, then refunds the ₹1. See `src/onboarding.ts`.
3. **Plan each payment** by amount. `planCollection` returns the methods that fit, best first, and says why the others don't. See `src/router.ts`.
4. **Start the chosen payment.** `startPayment` creates a UPI request, a net banking redirect to the customer's bank, a dedicated account number to transfer to, or an e-NACH mandate. See `src/checkout.ts`.
5. **Pay out** to verified accounts with `planPayout`, which picks IMPS, RTGS or NEFT.

## Limits used

| Rail | Limit | Used for |
|---|---|---|
| UPI, person to person and ordinary merchants | ₹1L per payment, ₹1L/day | Small payments |
| UPI, NPCI-verified merchant categories | ₹2L to ₹5L per payment, ₹5L to ₹10L/day (none for business payments) | Higher-value merchant payments |
| Net banking via a payment gateway | Set by the payer's bank | One-off payments above UPI |
| Bank transfer to a virtual account | IMPS up to ₹5L; RTGS from ₹2L, no maximum; NEFT, no maximum | Large one-off payments |
| e-NACH mandate | Up to ₹1 crore per debit | Recurring payments |

The figures are in `src/limits.ts` and follow NPCI's change of 15 September 2025. Limits get revised, and banks can set lower ones for their own customers. Load them from config in production, and check the current NPCI circulars before launch. You can pass your own limits to `planCollection` and `planPayout`.

## Running it

Needs Node 22.18 or later. Node runs the TypeScript directly, so there's no build step.

```sh
npm install
npm test           # unit tests
npm run typecheck  # tsc, no output files
npm run demo       # walk-through against the sandbox
```

## What's real and what's a placeholder

- **Real:** the routing rules, the limits, the UPI deep link builder, the verification flow, webhook signature checks, and masking account numbers for display.
- **Placeholder:** `src/providers/sandbox.ts` stands in for a licensed partner and moves no money. `src/providers/types.ts` lists the APIs to implement. Cashfree, Razorpay, Setu, Decentro and the banks' API banking offer each of them. Write one adapter per partner and swap it in for `SandboxPartner`.
- **Not included:** a database (implement `VerifiedAccountStore`), HTTP routes, OTP sign-in, and UPI AutoPay.

## Before going live

- Work through a licensed payment aggregator or bank. Holding customers' money yourself needs RBI authorisation.
- Never collect or store net banking credentials. Every method here sends the customer to their own bank to approve.
- Never split one payment into several UPI payments to get under the limit. Use the other methods instead.
- Check every partner webhook's signature against the raw request body before acting on it.
- Store full account numbers encrypted, and show only the masked form (`maskAccount`).
