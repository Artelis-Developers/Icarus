'use client';

import { agentById, type AgentId } from '../lib/agents';
import { AgentIcon } from './AgentIcon';
import styles from '../styles/topbar.module.css';

interface Props {
  title: string;
  agentId: AgentId;
  onToggleSidebar: () => void;
  onWip: (label: string) => void;
}

export function TopBar({ title, agentId, onToggleSidebar, onWip }: Props) {
  const agent = agentById(agentId);
  return (
    <header className={styles.header}>
      <button className={styles.iconBtn} onClick={onToggleSidebar} title="Collapse / expand sidebar" aria-label="Toggle sidebar">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18" />
        </svg>
      </button>

      <div className={styles.titleWrap}>
        <span className={styles.badge} style={{ ['--agent' as string]: agent.color }}>
          <AgentIcon agent={agentId} size={16} />
        </span>
        <div className={styles.titles}>
          <div className={styles.title}>{title}</div>
          <div className={styles.subtitle}>{agent.name} · Ikairus</div>
        </div>
      </div>

      <button className={styles.searchBtn} onClick={() => onWip('Search — coming soon')}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <span className={styles.searchLabel}>Search</span>
      </button>
    </header>
  );
}
