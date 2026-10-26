import { Alert, Linking, Platform } from 'react-native';
import { iosUpiAppLinks } from './upi-links';

/** Hands the payment request to the payer's UPI app. They approve it there with their UPI PIN. */
export async function openUpiApp(upiIntent: string): Promise<void> {
  if (Platform.OS === 'android') {
    // Android shows its own chooser of installed UPI apps.
    await Linking.openURL(upiIntent).catch(() => {
      throw new Error('No UPI app found on this phone');
    });
    return;
  }
  const installed = [];
  for (const app of iosUpiAppLinks(upiIntent)) {
    if (await Linking.canOpenURL(app.url)) installed.push(app);
  }
  if (installed.length === 0) throw new Error('No UPI app found on this phone');
  if (installed.length === 1) {
    await Linking.openURL(installed[0]!.url);
    return;
  }
  Alert.alert('Pay with', undefined, [
    ...installed.map((app) => ({ text: app.name, onPress: () => void Linking.openURL(app.url) })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}
