'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  AuthProvider as PortalAuthProvider,
  useAuth as useLibAuth,
  getPortalAuth,
  STORAGE_KEYS,
  type AuthContextType,
  type AuthUser,
} from '@artelis/auth';

import { PortalUserSync } from '../components/portal-user-sync';
import { emailFromUnverifiedIdToken, nameFromEmailLocalPart } from '../lib/display-identity';
import { resolvePortalMeUser } from '../lib/portal-user-profile';

/**
 * Dev-only bypass identity: lets Icarus run standalone (outside the portal
 * iframe) in development without a Cognito token. Never active inside an iframe
 * or in production — see @artelis/auth's AuthProvider `devBypass` (default true).
 */
const DEV_USER: AuthUser = {
  id: 'demo-user',
  name: 'Icarus Dev',
  email: 'dev@artelis.net',
  role: 'admin',
};

const MeRevisionContext = createContext(0);

/**
 * Resolve the portal id token — same tiered fallback as stream's access token.
 * The id token carries `email` for SSO users whose access token does not.
 */
function resolveIdToken(): string | null {
  if (typeof window === 'undefined') return null;

  const fromSingleton = getPortalAuth()?.getIdToken()?.trim();
  if (fromSingleton) return fromSingleton;

  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.tokens);
    if (!raw) return null;
    const tokens = JSON.parse(raw) as { id_token?: string; expires_at?: number };
    const storedToken = tokens.id_token?.trim();
    if (!storedToken) return null;
    if (typeof tokens.expires_at === 'number' && Date.now() >= tokens.expires_at) return null;
    return storedToken;
  } catch {
    return null;
  }
}

/**
 * Wraps the library's `useAuth()`. Cognito access tokens often lack email for
 * SSO users — prefer id-token email, then portal `GET /auth/me` cache.
 *
 * Never use the Cognito/portal `name` claim (opaque SSO ids in production).
 * Display name is derived only from email (`igor.winandy@…` → "Igor Winandy").
 */
export function useAuth(): AuthContextType {
  const auth = useLibAuth();
  const meRevision = useContext(MeRevisionContext);

  return useMemo(() => {
    if (!auth.user || !auth.isAuthenticated) return auth;

    const idToken = resolveIdToken();
    const fromIdToken = idToken ? emailFromUnverifiedIdToken(idToken) : undefined;
    const me = resolvePortalMeUser();
    // Email only — never me.name / auth.user.name (those are SSO subject strings in prod)
    const email = (fromIdToken || me?.email?.trim() || auth.user.email?.trim() || '').trim();

    return {
      ...auth,
      user: {
        ...auth.user,
        email,
        name: email ? nameFromEmailLocalPart(email) : '',
      },
    };
    // meRevision bumps after `/auth/me` lands in sessionStorage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, meRevision]);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [meRevision, setMeRevision] = useState(0);
  const onSynced = useCallback(() => setMeRevision((n) => n + 1), []);

  return (
    <PortalAuthProvider
      devUser={DEV_USER}
      onAuthError={(message) => console.warn('[auth] portal auth error:', message)}
    >
      <PortalUserSync onSynced={onSynced} />
      <MeRevisionContext.Provider value={meRevision}>{children}</MeRevisionContext.Provider>
    </PortalAuthProvider>
  );
}
