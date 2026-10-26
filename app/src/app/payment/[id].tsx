import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Banner, Body, Button, Card, DetailRow, ErrorText, Field, Loading, Screen, StatusChip, Title } from '../../components/ui';
import type { OrderView, PaymentInstructions } from '../../lib/api';
import { amountInWords, formatInr } from '../../lib/money';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';
import { openUpiApp } from '../../lib/upi';
import { useAction } from '../../lib/use-action';

const POLL_MS = 3000;

type TransferDetails = PaymentInstructions['payment'];

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
        {isPayer ? <DetailRow label="ePay commission" value={formatInr(order.fee)} /> : null}
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
    <CommissionCard
      order={order}
      details={instructions.commission}
      reference={instructions.reference}
      onChange={onChange}
      numbered={sending}
    />
  );

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
            {commission}
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
      <Card>
        <Title>Send these two payments</Title>
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
  );
}

function CommissionCard({
  order,
  details,
  reference,
  onChange,
  numbered,
}: StepProps & { details: TransferDetails; reference: string; numbered: boolean }) {
  const { api, sandbox } = useSession();
  const { run, busy, error } = useAction();
  return (
    <TransferCard
      title={`${numbered ? '2. ' : ''}${formatInr(order.fee)} commission to ePay`}
      details={details}
      reference={reference}
      done={order.commissionPaid === true}
      doneLabel="ePay has received it"
    >
      {order.commissionPaid ? null : (
        <>
          <Body muted>ePay's account never changes, so add it as a beneficiary once. Keep the reference in the remarks.</Body>
          {sandbox ? (
            <Button
              title="Simulate commission received"
              variant="secondary"
              onPress={() => run(async () => onChange(await api.sandbox.payCommission(order.id)))}
              busy={busy}
            />
          ) : null}
          <ErrorText error={error} />
        </>
      )}
    </TransferCard>
  );
}

/** One transfer: a UPI button when it fits, and the bank details to copy. */
function TransferCard({
  title,
  details,
  reference,
  done = false,
  doneLabel,
  children,
}: {
  title: string;
  details: TransferDetails;
  reference: string;
  done?: boolean;
  doneLabel?: string;
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
      {done ? (
        <Banner tone="success">✓ {doneLabel}</Banner>
      ) : (
        <>
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
        </>
      )}
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
});
