import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { BankLinkCard } from '../../components/bank-link';
import { Banner, Body, Button, Card, DetailRow, ErrorText, Field, Loading, Screen, StatusChip, Title } from '../../components/ui';
import type { OrderView, TransferDetails } from '../../lib/api';
import { amountInWords, formatInr } from '../../lib/money';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';
import { openUpiApp } from '../../lib/upi';
import { useAction } from '../../lib/use-action';

const POLL_MS = 3000;

export default function Payment() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The commission is confirmed by ePay's bank and the other side acts on their
  // own phone, so keep checking while this screen is open and anything is open.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const poll = async () => {
        try {
          const latest = await api.payment(id);
          if (!active) return;
          setOrder(latest);
          setLoadError(null);
          if (latest.status !== 'received' || latest.commissionPaid === false) timer = setTimeout(poll, POLL_MS);
        } catch (caught) {
          if (!active) return;
          setLoadError(caught instanceof Error ? caught.message : String(caught));
          timer = setTimeout(poll, POLL_MS * 2);
        }
      };
      void poll();
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [api, id]),
  );

  if (!order) {
    return loadError ? (
      <Screen>
        <ErrorText error={loadError} />
      </Screen>
    ) : (
      <Loading />
    );
  }

  const isPayer = order.role === 'payer';
  const otherName = isPayer ? order.payee.name : order.payer.name;
  const commissionDue = order.commissionPaid === false && order.status !== 'awaiting_transfer';

  return (
    <Screen>
      <Card style={styles.summary}>
        <Body muted>
          {isPayer ? 'To' : 'From'} {otherName}
        </Body>
        <Text style={styles.amount}>{formatInr(order.amount)}</Text>
        <Body muted>{amountInWords(order.amount)}</Body>
        <StatusChip status={order.status} role={order.role} commissionDue={commissionDue} />
      </Card>

      {isPayer ? <PayerStep order={order} onChange={setOrder} /> : <PayeeStep order={order} onChange={setOrder} />}
      <ErrorText error={loadError} />

      <Card>
        <DetailRow label={isPayer ? 'To' : 'From'} value={otherName} />
        {isPayer ? <DetailRow label="Their account" value={`${order.payee.maskedAccountNumber} · ${order.payee.ifsc}`} /> : null}
        {isPayer ? <DetailRow label="ePay commission, incl. GST" value={formatInr(order.fee)} /> : null}
        <DetailRow label="Reference" value={order.reference} />
        {order.utr ? <DetailRow label="Bank reference (UTR)" value={order.utr} copyable /> : null}
      </Card>

      {order.status === 'received' && !commissionDue ? (
        <Button title="Back to home" variant="secondary" onPress={() => router.dismissTo('/')} />
      ) : null}
    </Screen>
  );
}

interface StepProps {
  order: OrderView;
  onChange: (order: OrderView) => void;
}

function PayerStep({ order, onChange }: StepProps) {
  const { api } = useSession();
  const { run, busy, error } = useAction();
  const [utr, setUtr] = useState('');
  const { instructions } = order;
  if (!instructions) return null;
  const payee = order.payee.name;
  const sending = order.status === 'awaiting_transfer' || order.status === 'not_received';

  const commission = (
    <CommissionCard order={order} onChange={onChange} numbered={sending} />
  );

  const oneApproval = <OneApprovalCard order={order} onChange={onChange} />;

  if (!sending) {
    return (
      <>
        {order.status === 'sent' ? (
          <Banner tone="info">Waiting for {payee} to confirm the money has arrived in their account.</Banner>
        ) : (
          <Banner tone="success">{payee} confirmed they received it.</Banner>
        )}
        {order.commissionPaid ? null : (
          <>
            <Banner tone="warning">
              ePay hasn't received the {formatInr(order.fee)} commission yet. You can start your next payment once it arrives.
            </Banner>
            {oneApproval}
            {order.bankRequest?.status === 'pending' ? null : commission}
          </>
        )}
      </>
    );
  }

  return (
    <>
      {order.status === 'not_received' ? (
        <Banner tone="error">
          {payee} says the money hasn't arrived. Check with your bank, then enter the reference again once it has gone.
        </Banner>
      ) : null}
      {oneApproval}
      {order.bankRequest?.status === 'pending' ? null : (
        <>
          <Card>
            <Title>{order.oneApproval ? 'Or send the two transfers yourself' : 'Send these two payments'}</Title>
            <Body>
              Send both now, in whichever order you like: {formatInr(order.amount + order.fee)} in total. Each goes straight to
              its own bank account.
            </Body>
          </Card>

          <TransferCard
            title={`1. ${formatInr(order.amount)} to ${payee}`}
            details={instructions.payment}
            reference={instructions.reference}
          >
            <Banner tone="info">
              Many banks cap what you can send to a new beneficiary in the first day. Check your bank's limit before a large first
              payment.
            </Banner>
          </TransferCard>

          {commission}

          <Card>
            <Title>After sending the {formatInr(order.amount)}</Title>
            <Field
              label="Its bank reference (UTR or UPI Ref No.)"
              hint="Your bank app shows it once the money has gone. Sandbox: type any 12 digits."
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={26}
              value={utr}
              onChangeText={setUtr}
            />
            <ErrorText error={error} />
            <Button
              title="I've sent it"
              onPress={() => run(async () => onChange(await api.markSent(order.id, utr)))}
              busy={busy}
              disabled={utr.replace(/\s/g, '').length < 12}
            />
          </Card>
        </>
      )}
    </>
  );
}

/** What's still to send: the amount only if it was never sent (resending could pay twice), and an unpaid commission. */
function unsentParts(order: OrderView): ('payment' | 'commission')[] {
  return [...(order.status === 'awaiting_transfer' ? (['payment'] as const) : []), ...(order.commissionPaid ? [] : (['commission'] as const))];
}

/** Sending what's left through the payer's bank, for one approval there. */
function OneApprovalCard({ order, onChange }: StepProps) {
  const { api, me, sandbox } = useSession();
  const { run, busy, error } = useAction();
  const bank = me?.bankName ?? 'your bank';
  const request = order.bankRequest;
  const describe = (parts: ('payment' | 'commission')[]) =>
    parts
      .map((part) => (part === 'payment' ? `${formatInr(order.amount)} to ${order.payee.name}` : `the ${formatInr(order.fee)} commission to ePay`))
      .join(' and ');
  const simulate = (outcome: 'approve' | 'decline' | 'commission_fails') =>
    run(async () => onChange(await api.sandbox.bank(order.id, outcome)));

  if (request?.status === 'pending') {
    return (
      <Card>
        <Title>Approve it in {bank}</Title>
        <Body>
          {bank} has ePay's request to send {describe(request.parts)}. Approve it once in your bank's app or net banking.
        </Body>
        <View style={styles.waiting}>
          <ActivityIndicator color={colors.blue} />
          <Body muted>Waiting for {bank}…</Body>
        </View>
        {sandbox ? (
          <>
            <Button title="Simulate approval in bank" variant="secondary" onPress={() => simulate('approve')} busy={busy} />
            <Button title="Simulate the commission failing" variant="link" onPress={() => simulate('commission_fails')} disabled={busy} />
            <Button title="Simulate declining" variant="link" onPress={() => simulate('decline')} disabled={busy} />
          </>
        ) : null}
        <ErrorText error={error} />
      </Card>
    );
  }

  // Not linked yet: offer it, if ePay can connect to their bank.
  if (!order.oneApproval) return me?.oneApproval === 'linked' ? null : <BankLinkCard />;

  const parts = unsentParts(order);
  const total = parts.reduce((sum, part) => sum + (part === 'payment' ? order.amount : order.fee), 0);
  return (
    <Card>
      <Title>Send with one approval</Title>
      {request?.status === 'failed' ? <Banner tone="error">{bank} didn't send {describe(request.failedParts)}.</Banner> : null}
      <Body>
        ePay asks {bank} to send {describe(parts)}, each straight to its own account. You approve once, in your bank.
      </Body>
      <ErrorText error={error} />
      <Button
        title={`Send ${formatInr(total)} with one approval`}
        onPress={() => run(async () => onChange(await api.bankPay(order.id)))}
        busy={busy}
      />
    </Card>
  );
}

/** ePay's commission: only the amount and a UPI button. ePay's account details never reach the app. */
function CommissionCard({ order, onChange, numbered }: StepProps & { numbered: boolean }) {
  const { api, me, sandbox } = useSession();
  const { run, busy, error } = useAction();
  const title = `${numbered ? '2. ' : ''}${formatInr(order.fee)} commission to ePay`;
  const upiIntent = order.instructions?.commission.upiIntent ?? null;

  if (order.commissionPaid) {
    return (
      <Card>
        <Title>{title}</Title>
        <Banner tone="success">✓ ePay has received it</Banner>
      </Card>
    );
  }
  return (
    <Card>
      <Title>{title}</Title>
      {sandbox ? (
        <>
          <Banner tone="warning">Sandbox: no UPI app opens and no money moves.</Banner>
          <Button
            title="Simulate commission received"
            variant="secondary"
            onPress={() => run(async () => onChange(await api.sandbox.payCommission(order.id)))}
            busy={busy}
          />
        </>
      ) : upiIntent ? (
        <>
          <Body muted>Your UPI app opens with the amount and this payment's reference filled in.</Body>
          <Button title={`Pay ${formatInr(order.fee)} with UPI`} onPress={() => run(() => openUpiApp(upiIntent))} busy={busy} />
        </>
      ) : (
        <Body>
          This commission is over the UPI limit.{' '}
          {me?.oneApproval === 'linked' ? 'Send it with one approval above.' : 'Link your bank to send it with one approval, or contact ePay.'}
        </Body>
      )}
      <ErrorText error={error} />
    </Card>
  );
}

/** One transfer: a UPI button when it fits, and the bank details to copy. */
function TransferCard({
  title,
  details,
  reference,
  children,
}: {
  title: string;
  details: TransferDetails;
  reference: string;
  children?: ReactNode;
}) {
  const { sandbox } = useSession();
  const { run, error } = useAction();
  const { bankTransfer, upiIntent } = details;
  // The sandbox's UPI IDs aren't real, so it offers bank details only.
  const showUpi = Boolean(upiIntent) && !sandbox;
  return (
    <Card>
      <Title>{title}</Title>
      {showUpi ? (
        <Button title={`Pay ${formatInr(details.amount)} with UPI`} onPress={() => run(() => openUpiApp(upiIntent!))} />
      ) : null}
      <Text style={styles.subheading}>{showUpi ? 'Or by bank transfer' : 'By bank transfer'}</Text>
      <DetailRow label="Account number" value={bankTransfer.accountNumber} copyable />
      <DetailRow label="IFSC" value={bankTransfer.ifsc} copyable />
      <DetailRow label="Name" value={bankTransfer.beneficiaryName} copyable />
      <DetailRow label="Amount" value={formatInr(details.amount)} copyable copyValue={(details.amount / 100).toFixed(2)} />
      <DetailRow label="Remarks" value={reference} copyable />
      {bankTransfer.rails.length ? (
        <Text style={styles.rails}>Use {bankTransfer.rails.map((rail) => rail.toUpperCase()).join(', ')}</Text>
      ) : null}
      <ErrorText error={error} />
      {children}
    </Card>
  );
}

function PayeeStep({ order, onChange }: StepProps) {
  const { api } = useSession();
  const { run, busy, error } = useAction();
  const payer = order.payer.name;
  const confirm = () => run(async () => onChange(await api.markReceived(order.id)));

  switch (order.status) {
    case 'awaiting_transfer':
      return (
        <Banner tone="info">
          {payer} is paying you {formatInr(order.amount)}, straight into your account ({order.payee.maskedAccountNumber}). You'll
          be asked to confirm once they've sent it.
        </Banner>
      );

    case 'sent':
      return (
        <Card>
          <Title>Did you receive {formatInr(order.amount)}?</Title>
          <Body>
            {payer} says they've sent it. Check your bank account {order.payee.maskedAccountNumber} for this amount
            {order.utr ? ` and the reference ${order.utr}` : ''}.
          </Body>
          <ErrorText error={error} />
          <Button title="Yes, I received it" onPress={confirm} busy={busy} />
          <Button
            title="Not received yet"
            variant="secondary"
            onPress={() => run(async () => onChange(await api.markNotReceived(order.id)))}
            disabled={busy}
          />
        </Card>
      );

    case 'not_received':
      return (
        <Card>
          <Banner tone="warning">You said it hasn't arrived. {payer} has been asked to check with their bank.</Banner>
          <ErrorText error={error} />
          <Button title="It's arrived now" onPress={confirm} busy={busy} />
        </Card>
      );

    case 'received':
      return <Banner tone="success">You confirmed you received it. Done.</Banner>;
  }
}

const styles = StyleSheet.create({
  summary: { alignItems: 'center' },
  amount: { fontSize: 32, fontWeight: '800', color: colors.navy },
  subheading: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 4 },
  rails: { fontSize: 14, fontWeight: '600', color: colors.green },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
