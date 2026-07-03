'use client';

import styles from './chatheader.module.css';

export function ChatHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      </div>
      <div className={styles.titles}>
        <h1 className={styles.title}>AgentCore</h1>
        <span className={styles.subtitle}>Bedrock Harness · eu-north-1</span>
      </div>
      <div className={styles.status}>
        <span className={styles.statusDot} />
        <span className={styles.statusText}>Online</span>
      </div>
    </header>
  );
}
