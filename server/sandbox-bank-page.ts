// A pretend bank login page for the sandbox, so the whole net banking and
// e-NACH round trip can be tried on a phone. Real banks host their own pages.

export interface BankPageInput {
  requestId: string;
  kind: 'netbanking' | 'enach';
  payeeName: string;
  amountText: string;
}

export function sandboxBankPage({ requestId, kind, payeeName, amountText }: BankPageInput): string {
  const action = kind === 'enach' ? `Allow ${payeeName} to debit up to ${amountText} per payment` : `Pay ${amountText} to ${payeeName}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sandbox Bank</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #f2f4f8; color: #14213d; }
  header { background: #5b6472; color: #fff; padding: 16px; font-weight: 600; }
  main { padding: 16px; max-width: 420px; margin: 0 auto; }
  .note { background: #fff4d6; border-radius: 8px; padding: 12px; font-size: 14px; }
  .card { background: #fff; border-radius: 12px; padding: 16px; margin: 16px 0; }
  .amount { font-size: 28px; font-weight: 700; margin: 4px 0 8px; }
  button { width: 100%; padding: 14px; border: 0; border-radius: 10px; font-size: 16px; font-weight: 600; margin-top: 12px; }
  .approve { background: #02991d; color: #fff; }
  .decline { background: #fff; color: #b3261e; border: 1px solid #b3261e; }
</style>
</head>
<body>
<header>Sandbox Bank</header>
<main>
  <p class="note">Test page. No money moves. A real bank asks for your login and OTP here, on its own site.</p>
  <div class="card">
    <div>${escapeHtml(kind === 'enach' ? 'e-NACH mandate' : 'Net banking payment')}</div>
    <div class="amount">${escapeHtml(amountText)}</div>
    <div>${escapeHtml(action)}</div>
  </div>
  <form method="post" action="${escapeHtml(encodeURIComponent(requestId))}">
    <button class="approve" name="decision" value="approve">Approve</button>
    <button class="decline" name="decision" value="decline">Decline</button>
  </form>
</main>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
