'use client';

import { agentById, type AgentId } from '../lib/agents';
import { AgentIcon } from './AgentIcon';
import styles from '../styles/typingindicator.module.css';

interface Props {
  agentId: AgentId;
}

export function TypingIndicator({ agentId }: Props) {
  const agent = agentById(agentId);
  return (
    <div className={styles.row}>
      <span className={styles.avatar} style={{ ['--agent' as string]: agent.color }}>
        <AgentIcon agent={agentId} size={17} />
      </span>
      <div className={styles.dots}>
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
      </div>
    </div>
  );
}
