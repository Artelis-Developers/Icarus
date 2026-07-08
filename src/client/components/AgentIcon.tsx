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
    case 'hr':
      return (
        <svg {...svgBase} {...dims}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-1a6 6 0 0 1 16 0v1" />
        </svg>
      );
    case 'dev':
      return (
        <svg {...svgBase} {...dims}>
          <path d="M16 18l6-6-6-6" />
          <path d="M8 6l-6 6 6 6" />
        </svg>
      );
    case 'board':
      return (
        <svg {...svgBase} {...dims}>
          <path d="M9 18h6" />
          <path d="M10 22h4" />
          <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
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
