import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Body, Button, ErrorText } from '../components/ui';
import { SessionProvider, useSession } from '../lib/session';
import { colors } from '../lib/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { status, me } = useSession();
  if (status === 'loading' || status === 'unreachable') return <Splash />;

  const signedIn = status === 'signed-in';
  const verified = signedIn && me?.account != null;
  // Each screen is only reachable in the right state; when the state changes,
  // Expo Router moves to the first screen that is.
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.navy,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !verified}>
        <Stack.Screen name="verify" options={{ title: 'Verify your account' }} />
      </Stack.Protected>
      <Stack.Protected guard={verified}>
        <Stack.Screen name="index" />
        <Stack.Screen name="pay" options={{ title: 'Pay' }} />
        <Stack.Screen name="payment/[id]" options={{ title: 'Payment' }} />
        <Stack.Screen name="payment-return" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

function Splash() {
  const { status, error, retry } = useSession();
  return (
    <View style={styles.splash}>
      <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="ePay" />
      {status === 'unreachable' ? (
        <View style={styles.problem}>
          <ErrorText error={error} />
          <Body muted>Make sure the ePay server is running and this phone is on the same Wi-Fi.</Body>
          <Button title="Try again" onPress={retry} />
        </View>
      ) : (
        <ActivityIndicator size="large" color={colors.blue} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 32, padding: 24, backgroundColor: colors.surface },
  logo: { width: 200, height: 152 },
  problem: { alignSelf: 'stretch', gap: 12 },
});
