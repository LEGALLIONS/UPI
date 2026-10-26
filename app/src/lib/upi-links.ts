// iOS has no app chooser for upi:// links, so each UPI app is opened by its own
// scheme. These must also be listed under LSApplicationQueriesSchemes in app.json.
const IOS_UPI_APPS = [
  { name: 'Google Pay', prefix: 'tez://upi/pay' },
  { name: 'PhonePe', prefix: 'phonepe://pay' },
  { name: 'Paytm', prefix: 'paytmmp://pay' },
  { name: 'Other UPI app', prefix: 'upi://pay' },
];

/** The same payment request as a link for each UPI app on iOS. */
export function iosUpiAppLinks(upiIntent: string): { name: string; url: string }[] {
  const query = upiIntent.slice(upiIntent.indexOf('?'));
  return IOS_UPI_APPS.map((app) => ({ name: app.name, url: app.prefix + query }));
}
