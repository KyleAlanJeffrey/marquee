/**
 * Accounts, on the client side.
 *
 * Clerk holds the identity; this file is the seam between it and the rest of the
 * app, and it exists so the rest of the app never imports Clerk directly.
 *
 * **The key is required.** There is no keyless mode and nothing anywhere asks
 * whether accounts are switched on. A build without
 * `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` throws here, on purpose: the alternative was
 * a build that looked fine, quietly compiled every account-shaped thing out of
 * itself, and took two deploys to notice. `.env.production` is tracked so that a
 * fresh clone has the key without anyone configuring anything.
 */

import { ClerkProvider, useAuth as useClerkAuth, useUser } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { createContext, useContext, useEffect, useMemo } from 'react';

import { setTokenProvider } from '@/lib/api';

// Cut at the first whitespace: a publishable key never contains any, but a value
// pasted into a dashboard sometimes does. The v1.0.4 TestFlight build crashed on
// launch because the EAS env var carried the .env.production line's trailing
// "# production — …" comment into the value, and Clerk throws on a key it can't
// parse before the first frame renders. Trimming costs a valid key nothing and
// turns that paste accident back into a working app.
export const CLERK_PUBLISHABLE_KEY = (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '')
  .trim()
  .split(/\s/, 1)[0];

// A release build running on Clerk's *development* instance. Legal, and how the app
// ships today — there is only one instance — but it caps sign-ups, stamps
// "Development mode" on the card, and is the thing that will still be true by
// accident on the day a production instance exists and one build forgets to point at
// it. The key says which it is, so there is no reason for that day to be quiet.
if (!__DEV__ && CLERK_PUBLISHABLE_KEY.startsWith('pk_test_')) {
  console.warn(
    'Clerk: this is a production build using a pk_test_ (development) instance. ' +
      'Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to the pk_live_ key in .env.production.',
  );
}

export type AuthState = {
  /** Still deciding. Callers should not render a signed-out state on this. */
  loading: boolean;
  signedIn: boolean;
  userId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /**
   * A fresh session token for the Worker, or null when signed out.
   *
   * Async and not cached here on purpose: Clerk rotates these on a short expiry
   * and hands back a valid one on demand. Holding our own copy is how you end up
   * sending an expired token and calling it a server bug.
   */
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

/** Reads Clerk's hooks, so it only renders inside `<ClerkProvider>`. */
function ClerkBridge({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useClerkAuth();
  const { user } = useUser();

  const value = useMemo<AuthState>(
    () => ({
      loading: !isLoaded,
      signedIn: Boolean(isSignedIn),
      userId: userId ?? null,
      displayName: user?.fullName ?? user?.username ?? null,
      avatarUrl: user?.imageUrl ?? null,
      getToken: () => getToken(),
      signOut: () => signOut(),
    }),
    [isLoaded, isSignedIn, userId, user, getToken, signOut],
  );

  // Let the plain `fetch` wrappers in lib/api.ts reach the token. They are called
  // from query functions outside this tree, so a hook can't serve them.
  useEffect(() => {
    setTokenProvider(value.getToken);
    return () => setTokenProvider(null);
  }, [value.getToken]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    // `tokenCache` is Clerk's own: SecureStore (Keychain / EncryptedSharedPreferences)
    // on native, and deliberately `undefined` on web, where Clerk uses browser
    // storage instead. It also deletes a corrupt entry rather than reading it as an
    // empty session, which is why it replaced the wrapper that used to live here.
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ClerkBridge>{children}</ClerkBridge>
    </ClerkProvider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth used outside AuthProvider');
  return ctx;
}
