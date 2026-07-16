'use client';

import type { ReactNode } from 'react';
import { AuthGuard } from '@artelis/auth';
import { useAuth } from '../contexts/auth-context';
import styles from '../styles/auth-gate.module.css';

function Screen({ children }: { children: ReactNode }) {
  return <div className={styles.screen}>{children}</div>;
}

function Unauthenticated() {
  const { signIn } = useAuth();
  return (
    <Screen>
      <p className={styles.title}>Not signed in</p>
      <p className={styles.muted}>
        Open Icarus from the 360 portal to continue. If it was already open, retry the handshake.
      </p>
      <button type="button" className={styles.button} onClick={() => void signIn()}>
        Retry
      </button>
    </Screen>
  );
}

/**
 * Icarus-branded auth gate. Wraps @artelis/auth's AuthGuard but supplies our own
 * dark/green screens (via CSS-module tokens) so the app never pulls in the
 * @artelis/theme package — Icarus keeps its own design system.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  return (
    <AuthGuard
      renderLoading={() => (
        <Screen>
          <div className={styles.spinner} />
          <p className={styles.muted}>Authenticating…</p>
        </Screen>
      )}
      renderAccessDenied={() => (
        <Screen>
          <p className={styles.title}>Access denied</p>
          <p className={styles.muted}>This origin is not allowed to embed Icarus.</p>
        </Screen>
      )}
      renderUnauthenticated={() => <Unauthenticated />}
    >
      {children}
    </AuthGuard>
  );
}
