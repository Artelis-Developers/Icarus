import { STORAGE_KEYS } from '@artelis/auth';

/** Cached `/auth/me` profile — email/name the Cognito access token does not carry. */
export const PORTAL_ME_USER_STORAGE_KEY = 'portal_me_user';

export type PortalMeUser = {
  id: string;
  email?: string;
  name?: string;
  role?: string;
};

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, '');
}

export function readCachedPortalMeUser(): PortalMeUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(PORTAL_ME_USER_STORAGE_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as PortalMeUser;
    return typeof user.id === 'string' && user.id ? user : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the portal session profile (`GET /auth/me`). Same source as the portal UI — includes
 * `email` for SSO-federated users. Requires the portal to allow credentialed CORS from this origin.
 */
export async function refreshPortalMeUser(): Promise<PortalMeUser | null> {
  if (typeof window === 'undefined') return null;

  let origin: string | null = null;
  try {
    origin = sessionStorage.getItem(STORAGE_KEYS.inferredOrigin);
  } catch {
    return null;
  }
  if (!origin) return readCachedPortalMeUser();

  try {
    const response = await fetch(`${normalizeOrigin(origin)}/auth/me`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) return readCachedPortalMeUser();

    const data = (await response.json()) as { success?: boolean; user?: PortalMeUser };
    if (!data.success || typeof data.user?.id !== 'string' || !data.user.id) {
      return readCachedPortalMeUser();
    }

    sessionStorage.setItem(PORTAL_ME_USER_STORAGE_KEY, JSON.stringify(data.user));
    return data.user;
  } catch {
    return readCachedPortalMeUser();
  }
}

/** Cached portal profile, refreshing from `/auth/me` when missing. */
export async function ensurePortalMeUser(): Promise<PortalMeUser | null> {
  const cached = readCachedPortalMeUser();
  if (cached?.email) return cached;
  return refreshPortalMeUser();
}

export function resolvePortalMeUser(): PortalMeUser | null {
  return readCachedPortalMeUser();
}
