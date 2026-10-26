import * as Clipboard from 'expo-clipboard';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import type { CollectionMethod, OrderStatus } from '../lib/api';
import { colors, radius } from '../lib/theme';

export function Screen({
  children,
  edges = ['bottom'],
  background = colors.background,
}: {
  children: ReactNode;
  edges?: Edge[];
  background?: string;
}) {
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: background }]} edges={edges}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'link';

export function Button({
  title,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  busy?: boolean;
  disabled?: boolean;
}) {
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${variant}`],
        inactive && styles[`buttonDisabled_${variant}`],
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'primary' ? colors.surface : colors.blue} />
      ) : (
        <Text style={[styles.buttonText, styles[`buttonText_${variant}`], inactive && variant !== 'primary' && styles.textDisabled]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function HeaderLink({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" hitSlop={12} onPress={onPress}>
      <Text style={styles.headerLink}>{title}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function Field({ label, prefix, hint, ...input }: TextInputProps & { label: string; prefix?: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputRow}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput placeholderTextColor={colors.disabled} style={styles.input} accessibilityLabel={label} {...input} />
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

type Tone = 'info' | 'success' | 'warning' | 'error';

export function Banner({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <View style={[styles.banner, styles[`banner_${tone}`]]} accessibilityRole={tone === 'error' ? 'alert' : undefined}>
      <Text style={[styles.bannerText, tone === 'error' && { color: colors.error }, tone === 'warning' && { color: colors.warningText }]}>
        {children}
      </Text>
    </View>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? <Banner tone="error">{error}</Banner> : null;
}

/** A label and value, with a copy button for details the payer types into their bank app. */
export function DetailRow({
  label,
  value,
  copyable = false,
  copyValue = value,
}: {
  label: string;
  value: string;
  copyable?: boolean;
  /** What goes on the clipboard, when it differs from what's shown. */
  copyValue?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <View style={styles.detailRow}>
      <View style={styles.flex}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue} selectable>
          {value}
        </Text>
      </View>
      {copyable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Copy ${label}`}
          hitSlop={8}
          onPress={async () => {
            await Clipboard.setStringAsync(copyValue);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Text style={styles.copy}>{copied ? 'Copied' : 'Copy'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type ChipTone = 'action' | 'waiting' | 'done' | 'problem';
type Role = 'payer' | 'payee';

// What each step means to the person looking: something for them to do, or for the other side.
const STATUS_CHIPS: Record<OrderStatus, Record<Role, [label: string, tone: ChipTone]>> = {
  awaiting_fee: { payer: ['Pay fee', 'action'], payee: ['Not sent yet', 'waiting'] },
  awaiting_transfer: { payer: ['Send now', 'action'], payee: ['Not sent yet', 'waiting'] },
  sent: { payer: ['Awaiting confirmation', 'waiting'], payee: ['Confirm receipt', 'action'] },
  received: { payer: ['Paid', 'done'], payee: ['Received', 'done'] },
  not_received: { payer: ['Not received', 'problem'], payee: ['Not received', 'problem'] },
};

export function StatusChip({ status, role }: { status: OrderStatus; role: Role }) {
  const [label, tone] = STATUS_CHIPS[status][role];
  return (
    <View style={[styles.chip, styles[`chip_${tone}`]]}>
      <Text style={[styles.chipText, styles[`chipText_${tone}`]]}>{label}</Text>
    </View>
  );
}

export const METHOD_LABELS: Record<CollectionMethod, string> = {
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
};

export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.blue} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1 },
  screenContent: { padding: 16, gap: 16, paddingBottom: 32 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },

  button: { minHeight: 50, borderRadius: radius, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  button_primary: { backgroundColor: colors.blue },
  button_secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.blue },
  button_link: { minHeight: 40 },
  buttonDisabled_primary: { backgroundColor: colors.disabled },
  buttonDisabled_secondary: { borderColor: colors.disabled },
  buttonDisabled_link: {},
  pressed: { opacity: 0.8 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  buttonText_primary: { color: colors.surface },
  buttonText_secondary: { color: colors.blue },
  buttonText_link: { color: colors.blue },
  textDisabled: { color: colors.disabled },
  headerLink: { fontSize: 16, fontWeight: '600', color: colors.blue },

  card: { backgroundColor: colors.surface, borderRadius: radius, padding: 16, gap: 8, borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  body: { fontSize: 15, lineHeight: 22, color: colors.text },
  muted: { color: colors.muted },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },

  field: { gap: 6 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: 12,
  },
  prefix: { fontSize: 17, color: colors.muted, marginRight: 6 },
  input: { flex: 1, minHeight: 50, fontSize: 17, color: colors.text },
  hint: { fontSize: 13, color: colors.muted },

  banner: { borderRadius: radius, padding: 12 },
  banner_info: { backgroundColor: colors.infoBg },
  banner_success: { backgroundColor: colors.successBg },
  banner_warning: { backgroundColor: colors.warningBg },
  banner_error: { backgroundColor: colors.errorBg },
  bannerText: { fontSize: 14, lineHeight: 20, color: colors.text },

  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  detailLabel: { fontSize: 13, color: colors.muted },
  detailValue: { fontSize: 16, fontWeight: '600', color: colors.text },
  copy: { fontSize: 15, fontWeight: '600', color: colors.blue },

  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chip_action: { backgroundColor: colors.infoBg },
  chip_waiting: { backgroundColor: colors.warningBg },
  chip_done: { backgroundColor: colors.successBg },
  chip_problem: { backgroundColor: colors.errorBg },
  chipText: { fontSize: 13, fontWeight: '600' },
  chipText_action: { color: colors.blue },
  chipText_waiting: { color: colors.warningText },
  chipText_done: { color: colors.green },
  chipText_problem: { color: colors.error },
});
