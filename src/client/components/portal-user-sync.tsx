'use client';

import { useAuth as useLibAuth } from '@artelis/auth';
import { useEffect } from 'react';

import { refreshPortalMeUser } from '../lib/portal-user-profile';

/** Keep `/auth/me` profile cached so `useAuth` can surface real email/name for SSO users. */
export function PortalUserSync({ onSynced }: { onSynced?: () => void }) {
  const { isAuthenticated, user } = useLibAuth();

  useEffect(() => {
    if (!isAuthenticated) return;
    void refreshPortalMeUser().then((profile) => {
      if (profile) onSynced?.();
    });
  }, [isAuthenticated, user?.id, onSynced]);

  return null;
}
