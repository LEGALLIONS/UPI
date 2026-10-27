import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Body, Button, Card, DetailRow, ErrorText, Field, METHOD_LABELS, Screen, SectionLabel } from '../components/ui';
import type { PlanView } from '../lib/api';
import { amountInWords, formatInr, parseRupees } from '../lib/money';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import { useAction } from '../lib/use-action';

/** How long typing pauses before the commission and ways to send are worked out. */
const PLAN_DELAY_MS = 400;

export default function Pay() {
  const payee = useLocalSearchParams<{ payeeId: string; name: string; account: string; ifsc: string }>();
  const { api } = useSession();
  const [amountText, setAmountText] = useState('');
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const { run, busy, error } = useAction();
  const amount = parseRupees(amountText);

  // The commission shows under the amount as it's typed, worked out by the server like the payment itself.
  useEffect(() => {
    setPlan(null);
    setPlanError(null);
    if (!amount) return;
    let current = true;
    const timer = setTimeout(() => {
      api.plan({ payeeId: payee.payeeId, amount }).then(
        (latest) => {
          if (current) setPlan(latest);
        },
        (caught: unknown) => {
          if (current) setPlanError(caught instanceof Error ? caught.message : String(caught));
        },
      );
    }, PLAN_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [api, payee.payeeId, amount]);

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
        onChangeText={setAmountText}
        hint={amount ? amountInWords(amount) : undefined}
      />

      {plan ? (
        <Card>
          <DetailRow label={`To ${payee.name}, straight to their bank`} value={formatInr(plan.amount)} />
          <DetailRow
            label={`ePay commission (${plan.feePercent}% ${plan.gstIncluded ? 'incl.' : '+'} GST), after the transfer`}
            value={formatInr(plan.fee)}
          />
          <Text style={styles.totalLabel}>You pay in total</Text>
          <Text style={styles.total}>{formatInr(plan.amount + plan.fee)}</Text>
        </Card>
      ) : amount && !planError ? (
        <ActivityIndicator color={colors.blue} />
      ) : null}
      <ErrorText error={planError} />

      {plan ? (
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

          <Body muted>First the amount, straight to {payee.name}'s bank. Then, once it has gone, ePay's commission by UPI.</Body>
          <ErrorText error={error} />
          <Button title="Continue" onPress={start} busy={busy} />
        </>
      ) : null}
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
  totalLabel: { fontSize: 14, color: colors.muted },
  total: { fontSize: 26, fontWeight: '800', color: colors.navy },
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
