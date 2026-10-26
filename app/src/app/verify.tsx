import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Banner, Body, Button, Card, ErrorText, Field, HeaderLink, Screen, Title } from '../components/ui';
import type { UpiPaymentRequest } from '../lib/api';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';
import { openUpiApp } from '../lib/upi';
import { useAction } from '../lib/use-action';

export default function Verify() {
  const { api, sandbox, refresh, signOut } = useSession();
  const [request, setRequest] = useState<UpiPaymentRequest | null>(null);
  const [holderName, setHolderName] = useState('');
  const { run, busy, error } = useAction();

  // The bank confirms the ₹1 by webhook to the server; check every few seconds.
  // Once the account shows up, the layout moves on to the home screen by itself.
  useEffect(() => {
    if (!request) return;
    const timer = setInterval(() => void refresh().catch(() => undefined), 3000);
    return () => clearInterval(timer);
  }, [request, refresh]);

  const start = () =>
    run(async () => {
      const created = await api.startVerification();
      setRequest(created);
      if (!sandbox) await openUpiApp(created.upiIntent);
    });

  const simulate = () =>
    run(async () => {
      await api.sandbox.pennyDrop(request!.requestId, holderName);
      await refresh();
    });

  return (
    <Screen>
      <Stack.Screen options={{ headerRight: () => <HeaderLink title="Sign out" onPress={signOut} /> }} />
      <Card>
        <Title>One step before you pay</Title>
        <Body>
          Pay ₹1 from any UPI app on this phone. Your bank tells ePay the account number, IFSC and name it came from, so
          you never type them and nobody can fake them.
        </Body>
        <Body muted>The ₹1 comes back to you. Payments to you are settled to this account.</Body>
      </Card>

      {sandbox ? <Banner tone="warning">Sandbox: no UPI app opens and no money moves.</Banner> : null}

      {!request ? (
        <Button title="Pay ₹1 with UPI" onPress={start} busy={busy} />
      ) : sandbox ? (
        <Card>
          <Field
            label="Name on the account"
            hint="In real use this comes from the bank."
            autoCapitalize="words"
            placeholder="Arun Traders"
            value={holderName}
            onChangeText={setHolderName}
          />
          <Button title="Simulate ₹1 payment" onPress={simulate} busy={busy} />
        </Card>
      ) : (
        <Card>
          <View style={styles.waiting}>
            <ActivityIndicator color={colors.blue} />
            <Body>Waiting for your bank to confirm…</Body>
          </View>
          <Button title="Open UPI app again" variant="secondary" onPress={() => run(() => openUpiApp(request.upiIntent))} />
        </Card>
      )}
      <ErrorText error={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
