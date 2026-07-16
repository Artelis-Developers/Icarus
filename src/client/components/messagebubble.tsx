'use client';

import { memo, useCallback, useState, type MouseEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import type { ChatMessage } from '../lib/stream';
import { agentById, type AgentId } from '../lib/agents';
import { AgentIcon } from './AgentIcon';
import { CodeBlock } from './codeblock';
import styles from '../styles/messagebubble.module.css';

interface Props {
  message: ChatMessage;
  agentId: AgentId;
}

const markdownComponents: Components = {
  a: ({ children, href, ...props }) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </a>
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};

function MessageBubbleBase({ message, agentId }: Props) {
  const [copied, setCopied] = useState(false);

  const copyRawText = useCallback(async (raw: string, event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('a')) return;
    if (target.closest('[data-code-block]')) return;

    const selection = window.getSelection()?.toString().trim();
    if (selection) return;

    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard may be unavailable */
    }
  }, []);

  if (message.role === 'user') {
    return (
      <div className={styles.rowUser}>
        <div className={styles.userBubble}>{message.content}</div>
      </div>
    );
  }

  const agent = agentById(agentId);
  const textClass = message.isError ? styles.errorText : styles.agentText;
  const rawContent = message.content;

  return (
    <div className={styles.rowAgent}>
      <span className={styles.avatar} style={{ ['--agent' as string]: agent.color }}>
        <AgentIcon agent={agentId} size={17} />
      </span>
      <div className={styles.agentBody}>
        <div className={styles.agentName}>{agent.name}</div>
        <div
          className={`${textClass} ${styles.copyable} ${copied ? styles.copied : ''}`}
          title="Click to copy raw text"
          onClick={(event) => copyRawText(rawContent, event)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              void copyRawText(rawContent, event as unknown as MouseEvent<HTMLElement>);
            }
          }}
        >
          {message.isError || !rawContent ? (
            rawContent
          ) : (
            <div className={styles.markdown}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={markdownComponents}
              >
                {rawContent}
              </ReactMarkdown>
            </div>
          )}
          {copied && <span className={styles.copyHint}>Copied raw text</span>}
        </div>
      </div>
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleBase);
