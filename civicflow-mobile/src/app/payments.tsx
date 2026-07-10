import { Redirect } from 'expo-router';

/**
 * `/payments` is the allow-listed deep-link path for the Payments tab (the
 * tab's underlying route is still `/dues` — renaming it would break the
 * already-allow-listed `/dues` deep link some push notifications may still
 * reference). This stub exists purely so a `unestra://payments` or
 * `/payments` push tap has a real route to land on.
 */
export default function PaymentsRedirect() {
  return <Redirect href="/dues" />;
}
