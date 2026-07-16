'use client';

import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import styles from '../styles/codeblock.module.css';

interface Props {
  children: ReactNode;
}

function extractCodeText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractCodeText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    const element = node as { props: { children?: ReactNode } };
    return extractCodeText(element.props.children);
  }
  return '';
}

export function CodeBlock({ children }: Props) {
  const [copied, setCopied] = useState(false);
  const codeText = useMemo(() => extractCodeText(children).replace(/\n$/, ''), [children]);

  const copyCode = useCallback(
    async (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();

      const selection = window.getSelection()?.toString().trim();
      if (selection) return;

      try {
        await navigator.clipboard.writeText(codeText);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      } catch {
        /* clipboard may be unavailable */
      }
    },
    [codeText]
  );

  return (
    <div
      className={`${styles.block} ${copied ? styles.copied : ''}`}
      data-code-block
      title="Click to copy code"
      onClick={copyCode}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void copyCode(event as unknown as MouseEvent<HTMLElement>);
        }
      }}
    >
      <pre className={styles.pre}>{children}</pre>
      <span className={styles.badge}>{copied ? 'Copied' : 'Copy'}</span>
    </div>
  );
}
