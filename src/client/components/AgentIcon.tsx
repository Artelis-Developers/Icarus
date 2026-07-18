'use client';

import type { AgentId } from '../lib/agents';

interface Props {
  agent: AgentId;
  size?: number;
}

const svgBase = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Line-art glyph per agent, matching the design's icon set. */
export function AgentIcon({ agent, size = 18 }: Props) {
  const dims = { width: size, height: size };
  switch (agent) {
    case 'order':
      return (
        <svg {...svgBase} {...dims}>
          <circle cx="9" cy="20" r="1" />
          <circle cx="19" cy="20" r="1" />
          <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L22 8H6" />
        </svg>
      );
    // Parked with agents.ts: 'dev' | 'req_plan'
    case 'general':
    default:
      return (
        <svg {...svgBase} {...dims}>
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
        </svg>
      );
  }
}
