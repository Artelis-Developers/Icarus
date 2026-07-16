'use client';

import Image from 'next/image';
import type { Agent, AgentId } from '../lib/agents';
import type { Conversation } from '../hooks/usechat';
import { agentById } from '../lib/agents';
import { AgentIcon } from './AgentIcon';
import styles from '../styles/sidebar.module.css';

interface Props {
  collapsed: boolean;
  agents: Agent[];
  currentAgentId: AgentId;
  conversations: Conversation[];
  activeId: string;
  onNewChat: () => void;
  onSelectAgent: (id: AgentId) => void;
  onOpenConversation: (id: string) => void;
  onWip: (label: string) => void;
}

export function Sidebar({
  collapsed,
  agents,
  currentAgentId,
  conversations,
  activeId,
  onNewChat,
  onSelectAgent,
  onOpenConversation,
  onWip,
}: Props) {
  return (
    <aside className={`${styles.aside} ${collapsed ? styles.collapsed : ''}`}>
      {/* Brand */}
      <div className={styles.brand}>
        <div className={styles.brandBadge}>
          <Image src="/CEGECOM_logo_WHITE_NOTEXT.png" alt="Cegecom" width={26} height={26} className={styles.brandMark} />
        </div>
        <div className={styles.brandText}>
          <div className={styles.brandName}>Icarus</div>
          <div className={styles.brandSub}>Artelis · VSE NET · Cegecom</div>
        </div>
      </div>

      {/* New chat */}
      <div className={styles.newChatWrap}>
        <button className={styles.newChat} onClick={onNewChat}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className={styles.hideCollapsed}>New chat</span>
        </button>
      </div>

      {/* Agents */}
      <div className={`${styles.sectionLabel} ${styles.hideCollapsed}`}>Choose an agent</div>
      <div className={styles.agentList}>
        {agents.map((a) => {
          const active = a.id === currentAgentId;
          return (
            <button
              key={a.id}
              className={`${styles.agentRow} ${active ? styles.agentRowActive : ''}`}
              style={{ ['--agent' as string]: a.color }}
              onClick={() => onSelectAgent(a.id)}
              title={a.wired ? a.name : `${a.name} (coming soon)`}
            >
              <span className={styles.agentIcon}>
                <AgentIcon agent={a.id} size={18} />
              </span>
              <span className={`${styles.agentText} ${styles.hideCollapsed}`}>
                <span className={styles.agentName}>{a.name}</span>
                <span className={styles.agentDesc}>{a.desc}</span>
              </span>
              {!a.wired && <span className={`${styles.wipTag} ${styles.hideCollapsed}`}>WIP</span>}
            </button>
          );
        })}
      </div>

      {/* Recent */}
      <div className={`${styles.sectionLabel} ${styles.hideCollapsed}`}>Recent</div>
      <div className={styles.recent}>
        {conversations.length === 0 && (
          <div className={`${styles.recentEmpty} ${styles.hideCollapsed}`}>No conversations yet</div>
        )}
        {conversations.map((c) => {
          const active = c.id === activeId;
          return (
            <button
              key={c.id}
              className={`${styles.recentRow} ${styles.hideCollapsed} ${active ? styles.recentRowActive : ''}`}
              onClick={() => onOpenConversation(c.id)}
            >
              <span className={styles.recentDot} style={{ ['--agent' as string]: agentById(c.agentId).color }} />
              <span className={styles.recentTitle}>{c.title}</span>
            </button>
          );
        })}
      </div>

      {/* User footer (neutral placeholder — real identity injected later) */}
      <div className={styles.footer}>
        <div className={styles.avatar}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21v-1a6 6 0 0 1 16 0v1" />
          </svg>
        </div>
        <div className={`${styles.footerText} ${styles.hideCollapsed}`}>
          <div className={styles.footerName}>Signed in</div>
          <div className={styles.footerSub}>Artelis Group</div>
        </div>
        <button
          className={`${styles.gear} ${styles.hideCollapsed}`}
          onClick={() => onWip('Settings — coming soon')}
          aria-label="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
