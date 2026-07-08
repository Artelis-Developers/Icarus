'use client';

import styles from '../styles/wiptoast.module.css';

interface Toast {
  id: number;
  label: string;
}

interface Props {
  toasts: Toast[];
}

/**
 * Stack of auto-dismissing "work in progress" toasts. Positioned absolutely
 * inside the app container (not viewport-fixed) so it stays inside the frame
 * when the app is later embedded in an iframe.
 */
export function WipToast({ toasts }: Props) {
  if (toasts.length === 0) return null;
  return (
    <div className={styles.stack}>
      {toasts.map((t) => (
        <div key={t.id} className={styles.toast}>
          <span className={styles.icon} aria-hidden>
            🚧
          </span>
          <span>{t.label}</span>
        </div>
      ))}
    </div>
  );
}
