import { router } from 'expo-router';
import { useEffect } from 'react';
import { Loading } from '../components/ui';

// Banks send the payer back to epay://payment-return after net banking or e-NACH.
// The secure browser usually catches that link itself; if the app opens on it
// instead, go back to the payment screen underneath.
export default function PaymentReturn() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);
  return <Loading />;
}
