'use client';

import type { ReactNode } from 'react';
import { AuthProvider as PortalAuthProvider, useAuth, type AuthUser } from '@artelis/auth';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  return <PortalAuthProvider devUser={DEV_USER}>{children}</PortalAuthProvider>;
}

export { useAuth };
