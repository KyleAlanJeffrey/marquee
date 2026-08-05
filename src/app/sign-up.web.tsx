import { AuthScreen } from '@/components/auth-screen.web';

/** The sign-up half of the web auth screen — a real URL, not a query param on
 *  /sign-in, so Clerk's mid-flow hash navigation can never change the card. */
export default function SignUpScreen() {
  return <AuthScreen mode="sign-up" />;
}
