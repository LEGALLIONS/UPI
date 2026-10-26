import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Banner, Body, Button, Card, DetailRow, ErrorText, Field, Loading, Screen, StatusChip, Title } from '../../components/ui';
import type { OrderView } from '../../lib/api';
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

  // The fee is confirmed by webhook and the other side acts on their own phone,
  // so keep checking while this screen is open and the payment isn't finished.
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
          if (latest.status !== 'received') timer = setTimeout(poll, POLL_MS);
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

  return (
    <Screen>
      <Card style={styles.summary}>
        <Body muted>
          {isPayer ? 'To' : 'From'} {otherName}
        </Body>
        <Text style={styles.amount}>{formatInr(order.amount)}</Text>
        <Body muted>{amountInWords(order.amount)}</Body>
        <StatusChip status={order.status} role={order.role} />
      </Card>

      {isPayer ? <PayerStep order={order} onChange={setOrder} /> : <PayeeStep order={order} onChange={setOrder} />}
      <ErrorText error={loadError} />

      <Card>
        <DetailRow label={isPayer ? 'To' : 'From'} value={otherName} />
        {isPayer ? <DetailRow label="Their account" value={`${order.payee.maskedAccountNumber} · ${order.payee.ifsc}`} /> : null}
        {isPayer ? <DetailRow label="ePay fee" value={formatInr(order.fee)} /> : null}
        <DetailRow label="Reference" value={order.reference} />
        {order.utr ? <DetailRow label="Bank reference (UTR)" value={order.utr} copyable /> : null}
      </Card>

      {order.status === 'received' ? (
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
  const { api, sandbox } = useSession();
  const { run, busy, error } = useAction();
  const [utr, setUtr] = useState('');
  const payee = order.payee.name;

  switch (order.status) {
    case 'awaiting_fee': {
      const feeRequest = order.feeRequest;
      return (
        <Card>
          <Title>Step 1 of 2: ePay fee</Title>
          <Body>
            Pay ePay's fee of {formatInr(order.fee)} by UPI. As soon as it's confirmed, you'll see where to send the{' '}
            {formatInr(order.amount)}.
          </Body>
          {order.feeFailed ? (
            <>
              <Banner tone="error">The fee payment didn't go through. No money was taken for it.</Banner>
              <Button title="Try again" onPress={() => run(async () => onChange(await api.retryFee(order.id)))} busy={busy} />
            </>
          ) : sandbox ? (
            <>
              <Banner tone="warning">Sandbox: no UPI app opens and no money moves.</Banner>
              <Button title="Simulate fee payment" onPress={() => run(async () => onChange(await api.sandbox.payFee(order.id, 'success')))} busy={busy} />
              <Button
                title="Simulate a failed fee payment"
                variant="link"
                onPress={() => run(async () => onChange(await api.sandbox.payFee(order.id, 'failed')))}
                disabled={busy}
              />
            </>
          ) : feeRequest ? (
            <Button title={`Pay ${formatInr(order.fee)} fee with UPI`} onPress={() => run(() => openUpiApp(feeRequest.upiIntent))} busy={busy} />
          ) : null}
          <ErrorText error={error} />
        </Card>
      );
    }

    case 'awaiting_transfer':
    case 'not_received': {
      const instructions = order.instructions;
      if (!instructions) return null;
      const { bankTransfer } = instructions;
      return (
        <>
          {order.status === 'not_received' ? (
            <Banner tone="error">
              {payee} says the money hasn't arrived. Check with your bank, then enter the reference again once it has gone.
            </Banner>
          ) : null}
          <Card>
            <Title>Step 2 of 2: send it to {payee}</Title>
            <Body>The money goes straight from your bank to theirs, and arrives in seconds.</Body>
            {instructions.upiIntent && !sandbox ? (
              <Button title={`Pay ${formatInr(order.amount)} with UPI`} onPress={() => run(() => openUpiApp(instructions.upiIntent!))} />
            ) : null}
            <Text style={styles.subheading}>{instructions.upiIntent ? 'Or by bank transfer' : 'By bank transfer'}</Text>
            <Body muted>From your bank app or net banking:</Body>
            <DetailRow label="Account number" value={bankTransfer.accountNumber} copyable />
            <DetailRow label="IFSC" value={bankTransfer.ifsc} copyable />
            <DetailRow label="Name" value={bankTransfer.beneficiaryName} copyable />
            <DetailRow label="Amount" value={formatInr(order.amount)} copyable copyValue={(order.amount / 100).toFixed(2)} />
            <DetailRow label="Remarks" value={instructions.reference} copyable />
            {bankTransfer.rails.length ? (
              <Text style={styles.rails}>Use {bankTransfer.rails.map((rail) => rail.toUpperCase()).join(', ')}</Text>
            ) : null}
            <Banner tone="info">
              Many banks cap what you can send to a new beneficiary in the first day. Check your bank's limit before a large first payment.
            </Banner>
          </Card>
          <Card>
            <Title>After you've sent it</Title>
            <Field
              label="Bank reference (UTR or UPI Ref No.)"
              hint={sandbox ? 'Sandbox: type any 12 digits.' : 'Your bank app shows it once the money has gone.'}
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

    case 'sent':
      return <Banner tone="info">Waiting for {payee} to confirm the money has arrived in their account.</Banner>;

    case 'received':
      return <Banner tone="success">{payee} confirmed they received it. Done.</Banner>;
  }
}

function PayeeStep({ order, onChange }: StepProps) {
  const { api } = useSession();
  const { run, busy, error } = useAction();
  const payer = order.payer.name;
  const confirm = () => run(async () => onChange(await api.markReceived(order.id)));

  switch (order.status) {
    case 'awaiting_fee':
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
  subheading: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 8 },
  rails: { fontSize: 14, fontWeight: '600', color: colors.green },
});
