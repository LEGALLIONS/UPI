# ePay

A mobile app for paying businesses by mobile number, above the ₹1 lakh UPI limit, with the money arriving in seconds.

UPI stops at ₹1 lakh a day for most payments, and businesses often need to pay far more. ePay keeps UPI where it fits and uses bank transfer (IMPS, RTGS or NEFT) above that. Either way, the money goes **straight from the payer's bank to the payee's bank**. ePay never holds it, so there is no gateway settlement wait, and the payee has it in seconds. ePay never asks for a net banking password, and nobody types an account number.

ePay earns a **0.2% fee** on each payment, which the payer pays by UPI into ePay's own account before sending the main amount.

## How it works

1. **Sign in** with mobile number and OTP.
2. **Verify your bank account** by paying ₹1 by UPI. The bank reports the account number, IFSC, name and UPI ID the ₹1 came from (a *reverse penny drop*), and the ₹1 is refunded. Because these come from the bank, nobody can pass themselves off as another business, and payments to you land in the right account.
3. **Find who to pay** by their mobile number. Only verified ePay users show up, with their name as their bank has it.
4. **Enter the amount.** ePay shows the ways to send it and its fee (0.2%, at least ₹1).
5. **Pay the fee** by UPI. Once it's confirmed, ePay shows where to send the money:
   - **UPI** straight to the payee's own UPI ID, while it's within the limit
   - **Bank transfer** from your bank app or net banking straight to the payee's verified account, by IMPS (up to ₹5 lakh), RTGS (₹2 lakh and up) or NEFT
6. **Send it, and enter the bank reference** (UTR or UPI Ref No.) your bank shows.
7. **The payee confirms** in the app that it arrived. If it hasn't, they tap "Not received yet" and the payer checks with their bank.

## What's in the repo

| Folder | What it is |
|---|---|
| `app/` | The ePay mobile app (React Native with Expo, Android and iOS) |
| `server/` | The API the app talks to. It holds the partner API keys, which must never be in the app |
| `src/` | Payment logic: limits, choosing how to send, the fee, account verification, partner interfaces |
| `test/` | Tests for the server and payment logic |

## Try it on your phone

Both run in **sandbox mode**: no real money moves, and each step that would involve a bank has a "Simulate" button. When asked for a bank reference, type any 12 digits.

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

In the sandbox, the OTP appears on screen instead of by SMS. To pay someone, sign in on a second phone (or with a second number) and verify that account too. The payee confirms receipt from their own sign-in.

## Install the Android app (APK)

This gives you ePay as a normal app on your phone, with no computer needed once it's set up. It still runs in sandbox mode.

**1. Put the server online.** It needs an https address the app can reach from anywhere. The free plan on [Render](https://render.com) works:
- Sign up at render.com with your GitHub account.
- Choose **New → Blueprint**, pick this repository, and tap **Apply**. Render reads `render.yaml` and starts the server.
- When it says **Live**, copy its address, e.g. `https://epay-server.onrender.com`. Opening that address with `/health` added should show `{"ok":true}`.

The free plan sleeps after 15 minutes without use. The first request after that takes about a minute, and because the server keeps data in memory, all accounts and payments are wiped. Sign in and verify again when that happens.

**2. Build the APK.** On GitHub, open the **Actions** tab, choose **Android APK**, and tap **Run workflow**. Paste the server address and tap **Run workflow** again. The build takes about 25 minutes.

**3. Install it.** On your phone, open the repository's **Releases** page, open the newest **ePay app** release, and tap the `.apk` file. Android asks you to allow installing apps from your browser the first time; allow it, then tap **Install**.

To update the app, run the workflow again and install the new APK over the old one. If the server address changes, build a new APK, because the address is built into the app.

## Payment limits used

| Rail | Limit | Arrives |
|---|---|---|
| UPI, person to person and ordinary merchants | ₹1L per payment, ₹1L/day | Seconds |
| UPI, NPCI-verified merchant categories | ₹2L to ₹5L per payment, ₹5L to ₹10L/day (none for business payments) | Seconds |
| IMPS | Up to ₹5L per payment | Seconds |
| RTGS | From ₹2L, no maximum | Real time |
| NEFT | No maximum | Half-hourly batches |

The figures are in `src/limits.ts` and follow NPCI's change of 15 September 2025. Limits get revised, and banks can set lower ones for their own customers, so check the current NPCI circulars before launch. The fee rate is in `src/fees.ts`.

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

- **Real:** the app's screens and flows, choosing how to send, the limits, the fee, sign-in with OTP and sessions, account and UPI ID verification, payee lookup, the fee confirmed by signed webhook (with retries, and a late payment of an earlier fee request still counted), and the sent/received confirmation between payer and payee.
- **Placeholder:** `src/providers/sandbox.ts` stands in for a licensed partner and moves no money. `src/providers/types.ts` lists the two partner APIs ePay needs: reverse penny drop (Cashfree, Setu, Decentro and others) and UPI collection for the fee (any payment gateway). Write one adapter per partner and use it in place of `SandboxPartner`.
- **Not included yet:** a database (`server/store.ts` keeps everything in memory, so a restart loses it), SMS sending for OTPs (`OtpSender` in `server/auth.ts`), push notifications (so the payee hears about a payment without opening the app), and automatic confirmation of transfers (see below).

## Before going live

- **Partner for the fee:** sign up with a payment gateway (Razorpay, Cashfree, PayU…) to collect the fee by UPI into ePay's account. Its settlement time only affects when *you* get your fees, not when payees get paid.
- **GST:** if ePay is GST-registered, its fee is a taxable service (usually 18%). Decide whether 0.2% includes GST or GST is added on top, and show it on the fee screen.
- **Automatic confirmation:** today the payee confirms receipt by hand. To confirm automatically, sign API banking agreements with banks (ICICI, HDFC, Axis, Kotak and others offer them). With a payee's consent, their bank can notify ePay of incoming credits; with a payer's, ePay can start the transfer from their account for one-tap payments.
- **Disputes:** payments go bank to bank, so a payment marked "Not received" is settled between payer and payee with their banks. Keep the UTRs, and have a support contact for these cases.
- **UPI to personal UPI IDs:** some UPI apps restrict payment links that pay a person rather than a merchant. If that happens, bank transfer always works; payees with a business (merchant) UPI ID avoid it.
- **Server:** add a database, an SMS provider and the partner adapters; serve it over HTTPS; and set a strong `WEBHOOK_SECRET`. Remove the sandbox routes by not passing `sandbox` to `createApiServer`.
- **App:** set `EXPO_PUBLIC_API_URL` to your HTTPS server. Change `com.legallions.epay` in `app/app.json` if you publish under a different name. Build store apps with EAS (`npx eas-cli@latest build`). The APK from the **Android APK** workflow is signed with React Native's standard debug key: fine for installing directly, but the Play Store needs your own signing key.
- **iOS UPI apps:** iPhones have no UPI app chooser, so `app/src/lib/upi-links.ts` opens Google Pay, PhonePe or Paytm by name. Check these against each app's iOS documentation.
- **Business payees:** higher UPI limits apply only to payees that pass business verification (KYB) in an eligible NPCI category. Set `merchantCategory` on those users.
- Never collect or store net banking credentials, and never split one payment into several UPI payments to get under the limit.
