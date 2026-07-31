/**
 * Accounts, on the client side.
 *
 * Clerk holds the identity; this file is the seam between it and the rest of the
 * app, and it exists so that the rest of the app never imports Clerk directly.
 * Two reasons that matters here:
 *
 * 1. **No key means no accounts, and no accounts has to keep working.** Marquee
 *    shipped without them, and everything except publishing still works that way:
 *    browsing, following, saving, reminders and the private log are all on-device.
 *    So `<AuthProvider>` renders its children untouched when
 *    `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is unset — no provider, no network, no
 *    crash — and `useAuth()` answers "signed out" to everyone who asks. A fork
 *    with no Clerk account gets the app as it was.
 * 2. **Hooks can't be called conditionally.** Since the provider may be absent,
 *    anything reading Clerk's hooks has to be inside a component that only renders
 *    when it is present. That's what the split below is for, and it is the whole
 *    reason this is a context of our own rather than a re-export.
 */

import { ClerkProvider, useAuth as useClerkAuth, useUser } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useEffect, useMemo } from 'react';
import { Platform } from 'react-native';

import { setTokenProvider } from '@/lib/api';

/** Unset in local dev and on forks, which is a supported way to run this app. */
export const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';

export const authConfigured = Boolean(CLERK_PUBLISHABLE_KEY);

export type AuthState = {
  /** False when Clerk isn't configured at all — distinct from "signed out". */
  configured: boolean;
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

const SIGNED_OUT: AuthState = {
  configured: false,
  loading: false,
  signedIn: false,
  userId: null,
  displayName: null,
  avatarUrl: null,
  getToken: async () => null,
  signOut: async () => {},
};

const AuthContext = createContext<AuthState>(SIGNED_OUT);

/**
 * Where Clerk keeps the session between launches.
 *
 * `expo-secure-store` is the Keychain on iOS and EncryptedSharedPreferences on
 * Android. It has no web implementation, so on web this is left undefined and
 * Clerk falls back to its own browser storage — passing a broken shim would be
 * worse than passing nothing.
 */
const tokenCache =
  Platform.OS === 'web'
    ? undefined
    : {
        getToken: async (key: string) => {
          try {
            return await SecureStore.getItemAsync(key);
          } catch {
            // A corrupt or unreadable entry must read as "no session", not as a
            // crash on launch — the recovery is signing in again.
            return null;
          }
        },
        saveToken: async (key: string, value: string) => {
          try {
            await SecureStore.setItemAsync(key, value);
          } catch (err) {
            console.warn('auth: could not persist the session', err);
          }
        },
      };

/** Reads Clerk's hooks. Only ever rendered inside a real `<ClerkProvider>`. */
function ClerkBridge({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useClerkAuth();
  const { user } = useUser();

  const value = useMemo<AuthState>(
    () => ({
      configured: true,
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
  // No key: don't mount Clerk at all. `<ClerkProvider>` with an empty key throws,
  // and the point is that this configuration runs.
  if (!authConfigured) return <>{children}</>;
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ClerkBridge>{children}</ClerkBridge>
    </ClerkProvider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
