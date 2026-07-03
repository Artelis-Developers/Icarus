'use client';

import styles from './typingindicator.module.css';

export function TypingIndicator() {
  return (
    <div className={styles.container}>
      <div className={styles.avatar}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      </div>
      <div className={styles.dots}>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
