import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Body, Button, Card, DetailRow, ErrorText, Field, METHOD_LABELS, Screen, SectionLabel } from '../components/ui';
import type { PlanView } from '../lib/api';
import { amountInWords, formatInr, parseRupees } from '../lib/money';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import { useAction } from '../lib/use-action';

export default function Pay() {
  const payee = useLocalSearchParams<{ payeeId: string; name: string; account: string; ifsc: string }>();
  const { api } = useSession();
  const [amountText, setAmountText] = useState('');
  const [plan, setPlan] = useState<PlanView | null>(null);
  const { run, busy, error } = useAction();
  const amount = parseRupees(amountText);

  const showPlan = () => run(async () => setPlan(await api.plan({ payeeId: payee.payeeId, amount: amount! })));

  const start = () =>
    run(async () => {
      const order = await api.pay({ payeeId: payee.payeeId, amount: plan!.amount });
      router.replace(`/payment/${order.id}`);
    });

  return (
    <Screen>
      <Card>
        <Body muted>Paying</Body>
        <Text style={styles.payeeName}>{payee.name}</Text>
        <Body muted>
          {payee.account} · {payee.ifsc}
        </Body>
      </Card>

      <Field
        label="Amount"
        prefix="₹"
        keyboardType="decimal-pad"
        placeholder="0"
        autoFocus
        value={amountText}
        onChangeText={(text) => {
          setAmountText(text);
          setPlan(null);
        }}
        hint={amount ? amountInWords(amount) : undefined}
      />

      {!plan ? (
        <>
          <ErrorText error={error} />
          <Button title="See how to pay" onPress={showPlan} busy={busy} disabled={!amount} />
        </>
      ) : (
        <>
          <SectionLabel>Ways to send it</SectionLabel>
          {plan.options.map((option) => (
            <Option
              key={option.method}
              title={METHOD_LABELS[option.method]}
              detail={option.reason}
              rails={option.rails}
            />
          ))}
          {plan.unavailable.map((option) => (
            <Option key={option.method} title={METHOD_LABELS[option.method]} detail={option.reason} disabled />
          ))}

          <Card>
            <DetailRow label={`To ${payee.name}, straight to their bank`} value={formatInr(plan.amount)} />
            <DetailRow label={`ePay fee (${plan.feePercent}%), paid first by UPI`} value={formatInr(plan.fee)} />
            <Body muted>You'll see where to send the money as soon as the fee is paid.</Body>
          </Card>
          <ErrorText error={error} />
          <Button title={`Continue: pay ${formatInr(plan.fee)} fee`} onPress={start} busy={busy} />
        </>
      )}
    </Screen>
  );
}

function Option({ title, detail, rails, disabled = false }: { title: string; detail: string; rails?: string[]; disabled?: boolean }) {
  return (
    <View style={[styles.option, disabled && styles.optionDisabled]}>
      <Text style={[styles.optionMark, disabled ? styles.textDisabled : styles.optionMarkOn]}>{disabled ? '✕' : '✓'}</Text>
      <View style={styles.flex}>
        <Text style={[styles.optionTitle, disabled && styles.textDisabled]}>{title}</Text>
        <Text style={[styles.optionDetail, disabled && styles.textDisabled]}>{detail}</Text>
        {rails?.length ? <Text style={styles.rails}>Use {rails.map((rail) => rail.toUpperCase()).join(', ')}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  payeeName: { fontSize: 20, fontWeight: '700', color: colors.text },
  option: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionDisabled: { backgroundColor: colors.background },
  optionMark: { fontSize: 18, fontWeight: '700', width: 20, textAlign: 'center' },
  optionMarkOn: { color: colors.green },
  optionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  optionDetail: { fontSize: 14, lineHeight: 20, color: colors.muted },
  rails: { fontSize: 13, fontWeight: '600', color: colors.green, marginTop: 4 },
  textDisabled: { color: colors.disabled },
});
