import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';
import { useAction } from '../lib/use-action';
import { Banner, Body, Button, Card, ErrorText, Title } from './ui';

const POLL_MS = 3000;

/**
 * Offers to connect the payer's current account through their bank's API, so
 * ePay can ask the bank to send both parts of a payment for one approval.
 * Shows nothing once linked, or when ePay can't connect to their bank.
 */
export function BankLinkCard() {
  const { api, me, sandbox, refresh } = useSession();
  const { run, busy, error } = useAction();
  const state = me?.oneApproval;
  const bank = me?.bankName ?? 'your bank';
  /** Waits for a call, then reloads the signed-in user so the card shows the new state. */
  const afterwards = async (call: Promise<unknown>) => {
    await call;
    await refresh();
  };

  // The bank reports the approval to the server; check every few seconds.
  useEffect(() => {
    if (state !== 'pending') return;
    const timer = setInterval(() => void refresh().catch(() => undefined), POLL_MS);
    return () => clearInterval(timer);
  }, [state, refresh]);

  if (!state || state === 'unsupported' || state === 'linked') return null;

  if (state === 'pending') {
    return (
      <Card>
        <Title>Approve ePay in {bank}</Title>
        <Body>
          Open {bank}'s app or net banking and approve ePay as a connected service. You only do this once.
        </Body>
        <View style={styles.waiting}>
          <ActivityIndicator color={colors.blue} />
          <Body muted>Waiting for {bank}…</Body>
        </View>
        {sandbox ? (
          <>
            <Button
              title="Simulate approval in bank"
              variant="secondary"
              onPress={() => run(() => afterwards(api.sandbox.bankLink('approve')))}
              busy={busy}
            />
            <Button
              title="Simulate declining"
              variant="link"
              onPress={() => run(() => afterwards(api.sandbox.bankLink('decline')))}
              disabled={busy}
            />
          </>
        ) : null}
        <ErrorText error={error} />
      </Card>
    );
  }

  return (
    <Card>
      <Title>Pay with one approval</Title>
      <Body>
        Link your {bank} current account, and ePay asks your bank to send both parts of each payment at once: the amount to
        the payee and the commission to ePay. You approve once, in your bank.
      </Body>
      {state === 'declined' ? <Banner tone="warning">The link was declined in {bank}. You can try again.</Banner> : null}
      <ErrorText error={error} />
      <Button
        title={`Link my ${bank} account`}
        variant="secondary"
        onPress={() => run(() => afterwards(api.linkBank()))}
        busy={busy}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
