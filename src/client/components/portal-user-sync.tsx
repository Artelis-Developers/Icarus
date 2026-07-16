'use client';

import { useAuth as useLibAuth } from '@artelis/auth';
import { useEffect } from 'react';

import { emailFromUnverifiedIdToken } from '../lib/display-identity';
import {
  cachePortalMeUser,
  refreshPortalMeUser,
  type PortalMeUser,
} from '../lib/portal-user-profile';

/**
 * Capture identity email for SSO users.
 *
 * Portal cookies are SameSite=Lax, so cross-origin `GET /auth/me` from this
 * iframe usually cannot read the session. Prefer email from the parent's
 * `ms-auth` postMessage (portal session), then id token, then `/auth/me`.
 */
export function PortalUserSync({ onSynced }: { onSynced?: () => void }) {
  const { isAuthenticated, user } = useLibAuth();

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      if (message.type !== 'ms-auth' || message.success === false) return;

      const email =
        (typeof message.email === 'string' && message.email.trim()) ||
        (typeof message.id_token === 'string'
          ? emailFromUnverifiedIdToken(message.id_token)
          : undefined) ||
        '';
      if (!email) return;

      const id =
        (typeof message.user_id === 'string' && message.user_id.trim()) ||
        user?.id ||
        'portal-user';

      const profile: PortalMeUser = { id, email };
      cachePortalMeUser(profile);
      onSynced?.();
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSynced, user?.id]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void refreshPortalMeUser().then((profile) => {
      if (profile?.email) onSynced?.();
    });
  }, [isAuthenticated, user?.id, onSynced]);

  return null;
}
