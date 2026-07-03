'use client';

import { memo } from 'react';
import type { ChatMessage } from '@/client/lib/stream';
import styles from './messagebubble.module.css';

interface MessageBubbleProps {
  message: ChatMessage;
}

function MessageBubbleBase({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isError = message.isError;

  return (
    <div className={`${styles.bubble} ${isUser ? styles.user : styles.assistant} ${isError ? styles.error : ''}`}>
      {!isUser && !isError && (
        <div className={styles.avatar}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
      )}
      <div className={styles.content}>{message.content}</div>
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleBase);
