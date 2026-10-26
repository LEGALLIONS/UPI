# ePay

A mobile app for paying businesses by mobile number, above the ₹1 lakh UPI limit.

UPI stops at ₹1 lakh a day for most payments, and businesses often need to pay far more. ePay keeps UPI where it fits. Above that, it moves the payment to net banking, bank transfer or e-NACH, which have no UPI cap. The payer always approves on their own bank's page or in their own banking app. ePay never asks for a net banking password, and nobody types an account number.

## How it works

1. **Sign in** with mobile number and OTP.
2. **Verify your bank account** by paying ₹1 by UPI. The bank reports the account number, IFSC and name the ₹1 came from (a *reverse penny drop*), and the ₹1 is refunded. Because the name comes from the bank, nobody can pass themselves off as another business.
3. **Find who to pay** by their mobile number. Only verified ePay users show up, with their name as their bank has it.
4. **Enter the amount.** ePay shows the ways to pay that fit, best first, and says why the others don't:
   - **UPI** while it's within the limit
   - **Net banking**: log in on your bank's own page
   - **Bank transfer** (IMPS, RTGS or NEFT) to an account number that stays the same for that payee
   - **e-NACH** for monthly payments: approve once, later debits are automatic
5. **Done.** The licensed partner settles straight to the payee's verified account, so the money never sits with ePay.

## What's in the repo

| Folder | What it is |
|---|---|
| `app/` | The ePay mobile app (React Native with Expo, Android and iOS) |
| `server/` | The API the app talks to. It holds the partner API keys, which must never be in the app |
| `src/` | Payment logic: limits, choosing a payment method, account verification, partner interfaces |
| `test/` | Tests for the server and payment logic |

## Try it on your phone

Both run in **sandbox mode**: no real money moves, and each step that would involve a bank has a "Simulate" button or a test bank page.

You need Node 22.18 or later, and the free **Expo Go** app on your phone (Play Store or App Store). Your phone and computer must be on the same Wi-Fi.

```sh
# 1. Start the server
npm install
npm run server

# 2. In another terminal, start the app
cd app
npm install
npx expo start
```

Scan the QR code with your phone's camera (iPhone) or with Expo Go (Android). The app finds the server on your computer by itself. If it can't, start it with `EXPO_PUBLIC_API_URL=http://<your computer's IP>:3000 npx expo start`.

In the sandbox, the OTP appears on screen instead of by SMS. To pay someone, sign in on a second phone (or with a second number) and verify that account too.

## Install the Android app (APK)

This gives you ePay as a normal app on your phone, with no computer needed once it's set up. It still runs in sandbox mode.

**1. Put the server online.** It needs an https address the app can reach from anywhere. The free plan on [Render](https://render.com) works:
- Sign up at render.com with your GitHub account.
- Choose **New → Blueprint**, pick this repository, and tap **Apply**. Render reads `render.yaml` and starts the server.
- When it says **Live**, copy its address, e.g. `https://epay-server.onrender.com`. Opening that address with `/health` added should show `{"ok":true}`.

The free plan sleeps after 15 minutes without use. The first request after that takes about a minute, and because the server keeps data in memory, all accounts and payments are wiped. Sign in and verify again when that happens.

**2. Build the APK.** On GitHub, open the **Actions** tab, choose **Android APK**, and tap **Run workflow**. Paste the server address and tap **Run workflow** again. The build takes about 20 minutes.

**3. Install it.** On your phone, open the repository's **Releases** page, open the newest **ePay app** release, and tap the `.apk` file. Android asks you to allow installing apps from your browser the first time; allow it, then tap **Install**.

To update the app, run the workflow again and install the new APK over the old one. If the server address changes, build a new APK, because the address is built into the app.

## Payment limits used

| Rail | Limit | Used for |
|---|---|---|
| UPI, person to person and ordinary merchants | ₹1L per payment, ₹1L/day | Small payments |
| UPI, NPCI-verified merchant categories | ₹2L to ₹5L per payment, ₹5L to ₹10L/day (none for business payments) | Higher-value payments to verified businesses |
| Net banking via a payment gateway | Set by the payer's bank | One-off payments above UPI |
| Bank transfer to a virtual account | IMPS up to ₹5L; RTGS from ₹2L, no maximum; NEFT, no maximum | Large one-off payments |
| e-NACH mandate | Up to ₹1 crore per debit | Recurring payments |

The figures are in `src/limits.ts` and follow NPCI's change of 15 September 2025. Limits get revised, and banks can set lower ones for their own customers, so check the current NPCI circulars before launch.

## Development

```sh
npm test               # payment logic and server tests
npm run typecheck
npm run demo           # the payment logic on its own, in the terminal

cd app
npm test               # amount parsing and formatting
npm run typecheck
```

`app/AGENTS.md` has Expo's notes for working on the app.

## What's real and what's a placeholder

- **Real:** the app's screens and flows, choosing a payment method, the limits, sign-in with OTP and sessions, account verification, payee lookup, payment status from signed webhooks, and matching bank transfers by account and exact amount (once per bank reference).
- **Placeholder:** `src/providers/sandbox.ts` stands in for a licensed partner and moves no money. `src/providers/types.ts` lists the partner APIs to implement. Cashfree, Razorpay, Setu, Decentro and banks' API banking offer them. Write one adapter per partner and use it in place of `SandboxPartner`.
- **Not included yet:** a database (`server/store.ts` keeps everything in memory, so a restart loses it), SMS sending for OTPs (`OtpSender` in `server/auth.ts`), and push notifications.

## Before going live

- **Partner:** work through a licensed payment aggregator or bank, using its split-settlement feature so money goes straight to payees. Holding customers' money yourself needs RBI authorisation.
- **Server:** add a database, an SMS provider and the partner adapters; serve it over HTTPS; and set a strong `WEBHOOK_SECRET`. Remove the sandbox routes by not passing `sandbox` to `createApiServer`.
- **App:** set `EXPO_PUBLIC_API_URL` to your HTTPS server. Change `com.legallions.epay` in `app/app.json` if you publish under a different name. Build store apps with EAS (`npx eas-cli@latest build`). The APK from the **Android APK** workflow is signed with React Native's standard debug key: fine for installing directly, but the Play Store needs your own signing key.
- **Return links:** banks send payers back to `epay://payment-return`. Some gateways only accept `https://` return URLs; if so, host a page that redirects to the app link.
- **iOS UPI apps:** iPhones have no UPI app chooser, so `app/src/lib/upi-links.ts` opens Google Pay, PhonePe or Paytm by name. Check these against your partner's iOS documentation.
- **Business payees:** higher UPI limits apply only to payees that pass business verification (KYB) in an eligible NPCI category. Set `merchantCategory` on those users.
- Never collect or store net banking credentials, and never split one payment into several UPI payments to get under the limit.
