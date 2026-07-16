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
    case 'dev':
      return (
        <svg {...svgBase} {...dims}>
          <path d="M16 18l6-6-6-6" />
          <path d="M8 6l-6 6 6 6" />
        </svg>
      );
    case 'req_prio':
      return (
        <svg {...svgBase} {...dims}>
          <path d="M4 6h16" />
          <path d="M8 12h12" />
          <path d="M12 18h8" />
          <path d="M4 6v12" />
        </svg>
      );
    case 'req_plan':
      return (
        <svg {...svgBase} {...dims}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M8 10h8" />
          <path d="M8 14h5" />
        </svg>
      );
    case 'general':
    default:
      return (
        <svg {...svgBase} {...dims}>
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
        </svg>
      );
  }
}
