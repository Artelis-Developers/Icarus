'use client';

import { useEffect, type RefObject } from 'react';
import { agentById, type AgentId } from '../lib/agents';
import { AgentIcon } from './AgentIcon';
import styles from '../styles/composer.module.css';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  agentId: AgentId;
  inputRef: RefObject<HTMLTextAreaElement>;
  onWip: (label: string) => void;
}

export function Composer({ value, onChange, onSubmit, disabled, agentId, inputRef, onWip }: Props) {
  const agent = agentById(agentId);
  const sendDisabled = disabled || !value.trim();

  // Auto-size the textarea to content, capped at 180px.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [value, inputRef]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className={styles.zone} style={{ ['--agent' as string]: agent.color }}>
      <div className={styles.inner}>
        <div className={styles.box}>
          <textarea
            ref={inputRef}
            className={styles.textarea}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Message ${agent.name}…`}
            rows={1}
          />
          <div className={styles.controls}>
            <span className={styles.pill}>
              <AgentIcon agent={agentId} size={14} />
              {agent.name}
            </span>
            <span className={styles.spacer} />
            <button className={styles.iconBtn} title="Attach" onClick={() => onWip('Attachments — coming soon')} aria-label="Attach">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-8.49 8.49a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a1.5 1.5 0 0 1-2.12-2.12l7.78-7.78" />
              </svg>
            </button>
            <button className={styles.iconBtn} title="Voice / transcribe" onClick={() => onWip('Voice input — coming soon')} aria-label="Voice">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
                <path d="M12 19v3" />
              </svg>
            </button>
            <button className={styles.sendBtn} onClick={onSubmit} disabled={sendDisabled} aria-label="Send">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13" />
                <path d="M22 2l-7 20-4-9-9-4z" />
              </svg>
            </button>
          </div>
        </div>
        <div className={styles.disclaimer}>
          Icarus can access internal tools · conversations are stored per user · verify important answers.
        </div>
      </div>
    </div>
  );
}
