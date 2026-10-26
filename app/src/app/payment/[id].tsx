import * as Linking from 'expo-linking';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import {
  Banner,
  Body,
  Button,
  Card,
  DetailRow,
  ErrorText,
  Loading,
  METHOD_LABELS,
  Screen,
  StatusChip,
} from '../../components/ui';
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

  // Partners confirm payments by webhook to the server, so check while it's pending and on screen.
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
          if (latest.status === 'pending') timer = setTimeout(poll, POLL_MS);
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

  return (
    <Screen>
      <Card style={styles.summary}>
        <Body muted>
          {order.status === 'completed' ? 'Paid to' : 'Paying'} {order.payee.name}
        </Body>
        <Text style={styles.amount}>{formatInr(order.amount)}</Text>
        <Body muted>{amountInWords(order.amount)}</Body>
        <StatusChip status={order.status} />
      </Card>

      {order.status === 'pending' ? <NextStep order={order} onChange={setOrder} /> : <Outcome order={order} />}
      <ErrorText error={loadError} />

      <Card>
        <DetailRow label="To" value={order.payee.name} />
        <DetailRow label="Their account" value={`${order.payee.maskedAccountNumber} · ${order.payee.ifsc}`} />
        <DetailRow label="Paying by" value={METHOD_LABELS[order.method]} />
        {order.utr ? <DetailRow label="Bank reference (UTR)" value={order.utr} copyable /> : null}
        <DetailRow label="ePay reference" value={order.id} copyable />
      </Card>

      {order.status !== 'pending' ? <Button title="Back to home" variant="secondary" onPress={() => router.dismissTo('/')} /> : null}
    </Screen>
  );
}

function Outcome({ order }: { order: OrderView }) {
  if (order.status === 'failed') {
    return <Banner tone="error">This payment didn't go through. If money left your account, your bank sends it back.</Banner>;
  }
  if (order.method === 'enach') {
    return (
      <Banner tone="success">
        Mandate approved. {order.payee.name} can now collect up to {formatInr(order.amount)} per payment from your account.
      </Banner>
    );
  }
  return <Banner tone="success">Paid. The money goes straight to {order.payee.name}'s bank-verified account.</Banner>;
}

/** What the payer does next to finish a pending payment, for each way of paying. */
function NextStep({ order, onChange }: { order: OrderView; onChange: (order: OrderView) => void }) {
  const { api, sandbox } = useSession();
  const { run, busy, error } = useAction();
  const { instruction } = order;

  const simulate = (status: 'success' | 'failed') => run(async () => onChange(await api.sandbox.complete(order.id, status)));

  // Net banking and e-NACH happen on the bank's own site, in a secure browser the app can't see into.
  const openBank = (url: string) =>
    run(async () => {
      await WebBrowser.openAuthSessionAsync(url, Linking.createURL('payment-return'));
      onChange(await api.payment(order.id));
    });

  switch (instruction.method) {
    case 'upi':
      return (
        <Card>
          <Body>Approve it in your UPI app with your UPI PIN.</Body>
          {sandbox ? (
            <>
              <Banner tone="warning">Sandbox: no UPI app opens and no money moves.</Banner>
              <Button title="Simulate UPI payment" onPress={() => simulate('success')} busy={busy} />
              <Button title="Simulate a failed payment" variant="link" onPress={() => simulate('failed')} disabled={busy} />
            </>
          ) : (
            <Button title="Open UPI app" onPress={() => run(() => openUpiApp(instruction.upiIntent))} busy={busy} />
          )}
          <ErrorText error={error} />
        </Card>
      );

    case 'netbanking':
      return (
        <Card>
          <Body>You'll log in on your bank's own page and approve the payment there.</Body>
          <Body muted>ePay never sees your net banking password.</Body>
          <Button title="Continue to your bank" onPress={() => openBank(instruction.redirectUrl)} busy={busy} />
          <ErrorText error={error} />
        </Card>
      );

    case 'enach':
      return (
        <Card>
          <Body>
            Approve the mandate on your bank's page. After that, {order.payee.name} can collect up to {formatInr(order.amount)} per
            payment without asking again.
          </Body>
          <Button title="Approve with your bank" onPress={() => openBank(instruction.authUrl)} busy={busy} />
          <ErrorText error={error} />
        </Card>
      );

    case 'bank_transfer':
      return (
        <Card>
          <Body>
            Send exactly {formatInr(order.amount)} from your bank app to this account. It's the same account every time you pay{' '}
            {order.payee.name}, so you only add it as a beneficiary once.
          </Body>
          <DetailRow label="Account number" value={instruction.accountNumber} copyable />
          <DetailRow label="IFSC" value={instruction.ifsc} copyable />
          <DetailRow label="Beneficiary name" value={instruction.beneficiaryName} copyable />
          <DetailRow label="Amount" value={formatInr(order.amount)} copyable copyValue={(order.amount / 100).toFixed(2)} />
          {instruction.rails.length ? (
            <Text style={styles.rails}>Use {instruction.rails.map((rail) => rail.toUpperCase()).join(', ')}</Text>
          ) : null}
          <Banner tone="info">
            Many banks cap what you can send to a new beneficiary in the first day. Check your bank's limit before a large
            first payment.
          </Banner>
          {sandbox ? <Button title="Simulate transfer received" onPress={() => simulate('success')} busy={busy} /> : null}
          <ErrorText error={error} />
        </Card>
      );
  }
}

const styles = StyleSheet.create({
  summary: { alignItems: 'center' },
  amount: { fontSize: 32, fontWeight: '800', color: colors.navy },
  rails: { fontSize: 14, fontWeight: '600', color: colors.green },
});
