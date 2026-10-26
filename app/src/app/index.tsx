import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, Button, Card, ErrorText, Field, HeaderLink, METHOD_LABELS, Screen, SectionLabel, StatusChip } from '../components/ui';
import type { OrderView, PayeeView } from '../lib/api';
import { formatInr } from '../lib/money';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import { useAction } from '../lib/use-action';

export default function Home() {
  const { api, me, signOut } = useSession();
  const [mobile, setMobile] = useState('');
  const [payee, setPayee] = useState<PayeeView | null>(null);
  const [payments, setPayments] = useState<OrderView[] | null>(null);
  const lookup = useAction();

  useFocusEffect(
    useCallback(() => {
      api.payments().then(setPayments, () => setPayments([]));
    }, [api]),
  );

  const find = () =>
    lookup.run(async () => {
      setPayee(null);
      setPayee(await api.findPayee(mobile));
    });

  const pay = (found: PayeeView) =>
    router.push({
      pathname: '/pay',
      params: { payeeId: found.id, name: found.name, account: found.maskedAccountNumber, ifsc: found.ifsc },
    });

  return (
    <Screen>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Image source={require('../../assets/logo.png')} style={styles.headerLogo} resizeMode="contain" accessibilityLabel="ePay" />
          ),
          headerRight: () => <HeaderLink title="Sign out" onPress={signOut} />,
        }}
      />

      {me?.account ? (
        <View style={styles.accountCard}>
          <Text style={styles.accountLabel}>Your bank account</Text>
          <Text style={styles.accountName}>{me.account.holderName}</Text>
          <Text style={styles.accountDetail}>
            {me.account.maskedAccountNumber} · {me.account.ifsc}
          </Text>
          <Text style={styles.verified}>✓ Verified by your bank</Text>
        </View>
      ) : null}

      <SectionLabel>Pay someone</SectionLabel>
      <Card>
        <Field
          label="Their mobile number"
          prefix="+91"
          keyboardType="phone-pad"
          maxLength={14}
          placeholder="98765 43210"
          value={mobile}
          onChangeText={(text) => {
            setMobile(text);
            setPayee(null);
          }}
          onSubmitEditing={find}
        />
        <Button title="Find" variant="secondary" onPress={find} busy={lookup.busy} disabled={mobile.replace(/\D/g, '').length < 10} />
        <ErrorText error={lookup.error} />
        {payee ? (
          <View style={styles.payee}>
            <Body muted>Name as their bank has it</Body>
            <Text style={styles.payeeName}>{payee.name}</Text>
            <Body muted>
              {payee.maskedAccountNumber} · {payee.ifsc}
            </Body>
            <Button title={`Pay ${payee.name}`} onPress={() => pay(payee)} />
          </View>
        ) : null}
      </Card>

      <SectionLabel>Recent payments</SectionLabel>
      {payments === null ? (
        <ActivityIndicator color={colors.blue} />
      ) : payments.length === 0 ? (
        <Body muted>Payments you make show up here.</Body>
      ) : (
        <Card style={styles.list}>
          {payments.map((order, index) => (
            <Pressable
              key={order.id}
              accessibilityRole="button"
              onPress={() => router.push(`/payment/${order.id}`)}
              style={({ pressed }) => [styles.row, index > 0 && styles.rowDivider, pressed && styles.pressed]}
            >
              <View style={styles.rowMain}>
                <Text style={styles.rowName}>{order.payee.name}</Text>
                <Text style={styles.rowMeta}>
                  {METHOD_LABELS[order.method]} · {new Date(order.createdAt).toLocaleDateString('en-IN')}
                </Text>
              </View>
              <View style={styles.rowEnd}>
                <Text style={styles.rowAmount}>{formatInr(order.amount)}</Text>
                <StatusChip status={order.status} />
              </View>
            </Pressable>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerLogo: { width: 52, height: 40 },
  accountCard: { backgroundColor: colors.navy, borderRadius: radius, padding: 16, gap: 4 },
  accountLabel: { color: '#C9D6EE', fontSize: 13 },
  accountName: { color: colors.surface, fontSize: 20, fontWeight: '700' },
  accountDetail: { color: colors.surface, fontSize: 15 },
  verified: { color: '#7BE08F', fontSize: 13, fontWeight: '600', marginTop: 4 },
  payee: { gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  payeeName: { fontSize: 18, fontWeight: '700', color: colors.text },
  list: { padding: 0, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.background },
  rowMain: { flex: 1, gap: 2 },
  rowName: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 13, color: colors.muted },
  rowEnd: { alignItems: 'flex-end', gap: 4 },
  rowAmount: { fontSize: 16, fontWeight: '700', color: colors.text },
});
