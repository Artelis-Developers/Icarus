'use client';

import styles from './emptystate.module.css';

export function EmptyState() {
  return (
    <div className={styles.container}>
      <div className={styles.icon}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      </div>
      <h2 className={styles.heading}>Start a conversation</h2>
      <p className={styles.body}>
        Send a message below to chat with your AgentCore harness.
      </p>
      <div className={styles.suggestions}>
        <div className={styles.suggestionItem}>"What can you do?"</div>
        <div className={styles.suggestionItem}>"Run a shell command"</div>
        <div className={styles.suggestionItem}>"Read a file"</div>
      </div>
    </div>
  );
}
