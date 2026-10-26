import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Banner, Body, Button, ErrorText, Field, Screen } from '../components/ui';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';
import { useAction } from '../lib/use-action';

export default function SignIn() {
  const { api, signIn } = useSession();
  const [mobile, setMobile] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const { run, busy, error, setError } = useAction();

  const sendCode = (to: string) =>
    run(async () => {
      const response = await api.requestOtp(to);
      setSentTo(to);
      setDevCode(response.devCode ?? null);
      setCode('');
    });

  const verify = () =>
    run(async () => {
      const session = await api.signIn(sentTo!, code);
      await signIn(session.token, session.me);
    });

  return (
    <Screen edges={['top', 'bottom']} background={colors.surface}>
      <View style={styles.hero}>
        <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="ePay" />
        <Text style={styles.tagline}>Pay any business, any amount.</Text>
        <Body muted>
          Above the ₹1 lakh UPI limit, ePay moves your payment to net banking or bank transfer. You always approve it
          with your own bank.
        </Body>
      </View>

      {sentTo === null ? (
        <>
          <Field
            label="Your mobile number"
            prefix="+91"
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            maxLength={14}
            placeholder="98765 43210"
            value={mobile}
            onChangeText={setMobile}
            onSubmitEditing={() => sendCode(mobile)}
          />
          <ErrorText error={error} />
          <Button title="Send OTP" onPress={() => sendCode(mobile)} busy={busy} disabled={mobile.replace(/\D/g, '').length < 10} />
        </>
      ) : (
        <>
          <Body>Enter the 6-digit code sent to +91 {sentTo}.</Body>
          {devCode ? <Banner tone="warning">Sandbox: no SMS is sent. Your code is {devCode}.</Banner> : null}
          <Field
            label="OTP"
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={6}
            autoFocus
            value={code}
            onChangeText={setCode}
            onSubmitEditing={verify}
          />
          <ErrorText error={error} />
          <Button title="Verify and continue" onPress={verify} busy={busy} disabled={code.length !== 6} />
          <View style={styles.links}>
            <Button
              title="Change number"
              variant="link"
              onPress={() => {
                setSentTo(null);
                setError(null);
              }}
            />
            <Button title="Resend code" variant="link" onPress={() => sendCode(sentTo)} disabled={busy} />
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 12, paddingTop: 24, paddingBottom: 8 },
  logo: { width: 200, height: 152 },
  tagline: { fontSize: 22, fontWeight: '700', color: colors.navy, textAlign: 'center' },
  links: { flexDirection: 'row', justifyContent: 'space-between' },
});
