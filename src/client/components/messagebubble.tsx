'use client';

import { memo } from 'react';
import type { ChatMessage } from '../lib/stream';
import { agentById, type AgentId } from '../lib/agents';
import { AgentIcon } from './AgentIcon';
import styles from '../styles/messagebubble.module.css';

interface Props {
  message: ChatMessage;
  agentId: AgentId;
}

function MessageBubbleBase({ message, agentId }: Props) {
  if (message.role === 'user') {
    return (
      <div className={styles.rowUser}>
        <div className={styles.userBubble}>{message.content}</div>
      </div>
    );
  }

  const agent = agentById(agentId);
  return (
    <div className={styles.rowAgent}>
      <span className={styles.avatar} style={{ ['--agent' as string]: agent.color }}>
        <AgentIcon agent={agentId} size={17} />
      </span>
      <div className={styles.agentBody}>
        <div className={styles.agentName}>{agent.name}</div>
        <div className={message.isError ? styles.errorText : styles.agentText}>{message.content}</div>
      </div>
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleBase);
