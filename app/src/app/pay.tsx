import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Body, Button, Card, ErrorText, Field, METHOD_LABELS, Screen, SectionLabel } from '../components/ui';
import type { CollectionMethod, CollectionPlan } from '../lib/api';
import { amountInWords, formatInr, parseRupees } from '../lib/money';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import { useAction } from '../lib/use-action';

export default function Pay() {
  const payee = useLocalSearchParams<{ payeeId: string; name: string; account: string; ifsc: string }>();
  const { api } = useSession();
  const [amountText, setAmountText] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [plan, setPlan] = useState<CollectionPlan | null>(null);
  const [method, setMethod] = useState<CollectionMethod | null>(null);
  const { run, busy, error } = useAction();
  const amount = parseRupees(amountText);

  // Any change to what's being paid means the options need working out again.
  const resetPlan = () => {
    setPlan(null);
    setMethod(null);
  };

  const showOptions = () =>
    run(async () => {
      const next = await api.plan({ payeeId: payee.payeeId, amount: amount!, recurring });
      setPlan(next);
      setMethod(next.options[0]?.method ?? null);
    });

  const pay = () =>
    run(async () => {
      const order = await api.pay({
        payeeId: payee.payeeId,
        amount: plan!.amount,
        recurring,
        method: method!,
        returnUrl: Linking.createURL('payment-return'),
      });
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
          resetPlan();
        }}
        hint={amount ? amountInWords(amount) : undefined}
      />

      <View style={styles.switchRow}>
        <View style={styles.flex}>
          <Text style={styles.switchLabel}>Repeats every month</Text>
          <Body muted>Rent, EMIs, supplier bills: approve once with your bank, later debits are automatic.</Body>
        </View>
        <Switch
          accessibilityLabel="Repeats every month"
          value={recurring}
          onValueChange={(value) => {
            setRecurring(value);
            resetPlan();
          }}
          trackColor={{ true: colors.blue }}
        />
      </View>

      {!plan ? (
        <Button title="See payment options" onPress={showOptions} busy={busy} disabled={!amount} />
      ) : (
        <>
          <SectionLabel>How do you want to pay {formatInr(plan.amount)}?</SectionLabel>
          {plan.options.map((option) => (
            <Option
              key={option.method}
              title={METHOD_LABELS[option.method]}
              detail={option.reason}
              rails={option.rails}
              selected={method === option.method}
              onPress={() => setMethod(option.method)}
            />
          ))}
          {plan.unavailable.map((option) => (
            <Option key={option.method} title={METHOD_LABELS[option.method]} detail={option.reason} disabled />
          ))}
          <ErrorText error={error} />
          <Button title={`Pay ${formatInr(plan.amount)}`} onPress={pay} busy={busy} disabled={!method} />
        </>
      )}
      {!plan ? <ErrorText error={error} /> : null}
    </Screen>
  );
}

function Option({
  title,
  detail,
  rails,
  selected = false,
  disabled = false,
  onPress,
}: {
  title: string;
  detail: string;
  rails?: string[];
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.option, selected && styles.optionSelected, disabled && styles.optionDisabled]}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioDot} /> : null}</View>
      <View style={styles.flex}>
        <Text style={[styles.optionTitle, disabled && styles.textDisabled]}>{title}</Text>
        <Text style={[styles.optionDetail, disabled && styles.textDisabled]}>{detail}</Text>
        {rails?.length ? <Text style={styles.rails}>Use {rails.map((rail) => rail.toUpperCase()).join(', ')}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  payeeName: { fontSize: 20, fontWeight: '700', color: colors.text },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  option: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionSelected: { borderColor: colors.blue, borderWidth: 2, padding: 13 },
  optionDisabled: { backgroundColor: colors.background },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioSelected: { borderColor: colors.blue },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.blue },
  optionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  optionDetail: { fontSize: 14, lineHeight: 20, color: colors.muted },
  rails: { fontSize: 13, fontWeight: '600', color: colors.green, marginTop: 4 },
  textDisabled: { color: colors.disabled },
});
