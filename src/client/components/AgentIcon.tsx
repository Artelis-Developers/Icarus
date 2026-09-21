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
    case 'neworder':
      return (
        <svg {...svgBase} {...dims}>
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <path d="M3.27 6.96 12 12.01l8.73-5.05" />
          <path d="M12 22.08V12" />
        </svg>
      );
    case 'order_staging':
      return (
        <svg {...svgBase} {...dims}>
          <path d="M9 3h6" />
          <path d="M10 3v6.5L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 9.5V3" />
          <path d="M7.5 15h9" />
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
