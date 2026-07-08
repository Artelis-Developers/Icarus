'use client';

import Image from 'next/image';
import { agentById, SUGGESTIONS, type AgentId } from '../lib/agents';
import styles from '../styles/emptystate.module.css';

interface Props {
  agentId: AgentId;
  onPick: (text: string) => void;
}

export function EmptyState({ agentId, onPick }: Props) {
  const agent = agentById(agentId);
  const suggestions = SUGGESTIONS[agentId] || SUGGESTIONS.general;

  return (
    <div className={styles.container}>
      <div className={styles.badge}>
        <Image src="/CEGECOM_logo_WHITE_NOTEXT.png" alt="" width={40} height={40} className={styles.mark} />
      </div>
      <div className={styles.greeting}>How can I help?</div>
      <div className={styles.sub}>
        You&apos;re talking to {agent.name} — {agent.desc.toLowerCase()}. Pick a starter or type your own.
      </div>
      <div className={styles.grid}>
        {suggestions.map((s) => (
          <button key={s.title} className={styles.card} onClick={() => onPick(s.sub)}>
            <span className={styles.cardTitle}>{s.title}</span>
            <span className={styles.cardSub}>{s.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
