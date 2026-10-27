# ePay

A mobile app for paying businesses by mobile number, above the ₹1 lakh UPI limit, with the money arriving in seconds.

UPI stops at ₹1 lakh a day for most payments, and businesses often need to pay far more. ePay keeps UPI where it fits and uses bank transfer (IMPS, RTGS or NEFT) above that. Either way, the money goes **straight from the payer's bank to the payee's bank**. ePay never holds it, so there is no gateway settlement wait, and the payee has it in seconds. ePay never asks for a net banking password, and nobody types an account number.

ePay earns a **0.2% commission, GST included**, on each payment, on top of the amount. The payer sends it **after the payment has gone**, by UPI straight into ePay's own account: the amount goes to the payee's account first, then the commission to ePay's. Their next payment waits until the commission arrives.

## How it works

1. **Sign in** with mobile number and OTP.
2. **Verify your bank account** by paying ₹1 by UPI. The bank reports the account number, IFSC, name and UPI ID the ₹1 came from (a *reverse penny drop*), and the ₹1 is refunded. Because these come from the bank, nobody can pass themselves off as another business, and payments to you land in the right account.
3. **Find who to pay** by their mobile number. Only verified ePay users show up, with their name as their bank has it.
4. **Enter the amount.** As it's typed, ePay shows its commission right below it (0.2% including GST, at least ₹1) and the total.
5. **Step 1: send the amount**, straight to the payee's verified UPI ID (within the UPI limit) or account, by IMPS (up to ₹5 lakh), RTGS (₹2 lakh and up) or NEFT. The app shows a UPI button where UPI fits and the payee's bank details to copy. Then the payer taps "I've sent it": there is no bank reference (UTR) to type. Nobody links a bank account to ePay.
6. **Step 2: pay the commission.** As soon as the payer says the amount has gone, the app asks for ePay's commission: a single "Pay with UPI" button, whose link carries ePay's UPI ID and the payment's reference (e.g. `EPAY2C76CDDE`). The payer sees only the amount: ePay's account number and IFSC never reach the app. A commission over the UPI limit (on payments above ₹5 crore) is paid by arrangement with ePay.
7. **The commission is confirmed** by ePay's own bank reporting it arriving, matched by the reference. Until it's confirmed, the payer can't start another payment: the home screen asks them to pay it first. The payee isn't asked to confirm anything; they see the payment coming in, with its reference.
8. **If the money didn't go**, the payer taps "Money didn't go? Raise a complaint" on the commission step. ePay staff check with the banks, then waive the commission (which unblocks the payer) or reject the complaint (it stays due). See *Reviewing complaints* below.

## What's in the repo

| Folder | What it is |
|---|---|
| `app/` | The ePay mobile app (React Native with Expo, Android and iOS) |
| `server/` | The API the app talks to. It holds the partner API keys, which must never be in the app |
| `src/` | Payment logic: limits, choosing how to send, the commission, account verification, partner interfaces |
| `test/` | Tests for the server and payment logic |

## Try it on your phone

Both run in **sandbox mode**: no real money moves, and each step that would involve a bank has a "Simulate" button. Commissions go to a pretend ePay account until you set your own (see below).

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

In the sandbox, the OTP appears on screen instead of by SMS. To pay someone, sign in on a second phone (or with a second number) and verify that account too. The payee sees incoming payments from their own sign-in.

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

The figures are in `src/limits.ts` and follow NPCI's change of 15 September 2025. Limits get revised, and banks can set lower ones for their own customers, so check the current NPCI circulars before launch. The commission rate and its GST are in `src/fees.ts`.

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

- **Real:** the app's screens and flows, choosing how to send, the limits, the commission, sign-in with OTP and sessions, account and UPI ID verification, payee lookup, matching commission credits to payments by reference (from signed credit notices, each bank reference counted once), blocking new payments while a commission is owed, and complaints with ePay staff's review.
- **Placeholder:** `src/providers/sandbox.ts` stands in for partners and moves no money. `src/providers/types.ts` lists the APIs ePay needs: reverse penny drop (Cashfree, Setu, Decentro and others) and credit notifications from ePay's own bank. Write one adapter for each and use it in place of `SandboxPartner`.
- **Not included yet:** a database (`server/store.ts` keeps everything in memory, so a restart loses it), SMS sending for OTPs (`OtpSender` in `server/auth.ts`), push notifications (so the payee hears about a payment without opening the app), and a screen for ePay staff (complaints are reviewed through the API for now).

## Reviewing complaints

ePay staff review complaints with the server's `ADMIN_TOKEN` (on Render: the service's **Environment** page shows the value it generated). Until there's a staff screen, use these from a terminal:

```sh
# Open complaints, with both parties' accounts to check with the banks
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<your server>/admin/complaints

# The money didn't go: waive the commission, which unblocks the payer
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"outcome":"waive"}' https://<your server>/admin/payments/<paymentId>/complaint

# The money went: reject it, and the commission stays due
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"outcome":"reject"}' https://<your server>/admin/payments/<paymentId>/complaint
```

In the sandbox, the app also has buttons to simulate ePay waiving or rejecting a complaint.

## Before going live

- **Your commission account:** set `EPAY_ACCOUNT_NUMBER`, `EPAY_IFSC`, `EPAY_ACCOUNT_NAME` and `EPAY_UPI_ID` on the server (on Render: the service's **Environment** page). Use a current account with a business UPI ID, so its UPI link can carry the payment reference.
- **Commission notifications:** ask your bank for API banking credit notifications (or a statement API) on that account, and point them at `/webhooks/commission`. Until then, commissions can't be confirmed automatically. A credit without the reference in its remarks is logged for a person to match.
- **GST:** the 0.2% includes GST (18%), so on ₹600 ePay's own share is ₹508.47 and ₹91.53 is GST. To add GST on top instead (₹708 on a ₹3 lakh payment), set `gstIncluded: false` in `DEFAULT_FEE_POLICY` in `src/fees.ts` and redeploy the server; the app's pay screen then reads "0.2% + GST" without a new APK. Issue GST invoices for the commissions, and check the treatment with your accountant.
- **Complaints:** ePay doesn't check that the money reached the payee; the commission is due once the payer has sent it. A payer whose money didn't go raises a complaint, and ePay staff check it with the banks (both sides' statements show the transfer with the payment's reference). Decide how quickly you'll answer, and have a support contact for the cases the app doesn't cover.
- **UPI to personal UPI IDs:** some UPI apps restrict payment links that pay a person rather than a merchant. If that happens, bank transfer always works; payees with a business (merchant) UPI ID avoid it.
- **Server:** add a database, an SMS provider and the partner adapters; serve it over HTTPS; and set a strong `WEBHOOK_SECRET` and `ADMIN_TOKEN`. Remove the sandbox routes by not passing `sandbox` to `createApiServer`.
- **App:** set `EXPO_PUBLIC_API_URL` to your HTTPS server. Change `com.legallions.epay` in `app/app.json` if you publish under a different name. Build store apps with EAS (`npx eas-cli@latest build`). The APK from the **Android APK** workflow is signed with React Native's standard debug key: fine for installing directly, but the Play Store needs your own signing key.
- **iOS UPI apps:** iPhones have no UPI app chooser, so `app/src/lib/upi-links.ts` opens Google Pay, PhonePe or Paytm by name. Check these against each app's iOS documentation.
- **Business payees:** higher UPI limits apply only to payees that pass business verification (KYB) in an eligible NPCI category. Set `merchantCategory` on those users.
- Never collect or store net banking credentials, and never split one payment into several UPI payments to get under the limit.
