/**
 * Agent catalogue for Icarus.
 *
 * Agents with wired: true call /api/chat; the server routes each id to its
 * harness ARN via env vars (see src/server/api/chat/route.ts). Unwired agents
 * show a "coming soon" toast when selected.
 */

export type AgentId = 'general' | 'hr' | 'dev' | 'board';

export interface Agent {
  id: AgentId;
  name: string;
  desc: string;
  /** Per-agent accent, injected as the --agent CSS variable. */
  color: string;
  /** true once the agent is backed by a real endpoint. */
  wired: boolean;
}

export const AGENTS: Agent[] = [
  { id: 'general', name: 'General Assistant', desc: 'Everyday help across the group', color: 'var(--accent)', wired: true },
  { id: 'dev', name: 'Dev Bot', desc: 'Software ideas & engineering', color: '#ffa94d', wired: true },
  { id: 'hr', name: 'Order Bot', desc: 'Order products anywhere', color: '#5c7cfa', wired: false },
  { id: 'board', name: 'Ideas & Board', desc: 'Submit ideas & requests', color: '#ffd43b', wired: false },
];

export const DEFAULT_AGENT: AgentId = 'general';

export function agentById(id: string): Agent {
  return AGENTS.find((a) => a.id === id) || AGENTS[0];
}

/** Suggestion starter cards shown on the empty state, per agent. */
export const SUGGESTIONS: Record<AgentId, { title: string; sub: string }[]> = {
  general: [
    { title: 'Summarise a meeting', sub: 'Paste a transcript and get key points & action items.' },
    { title: 'Draft an email', sub: 'Write a clear message to a colleague or customer.' },
    { title: 'Explain a process', sub: 'How do I request access to a system?' },
    { title: 'Which agent do I need?', sub: 'Not sure who can help — describe your question.' },
  ],
  hr: [
    { title: 'Get address information', sub: 'Retrieve address information for a specific location.' },
    { title: 'Find a product', sub: 'Search for the right product for your client\'s needs.' },
    { title: 'Place an Order', sub: 'Place an order for a product or service.' },
    { title: 'Track an order', sub: 'Check the status of an existing order.' },
  ],
  dev: [
    { title: 'New software idea', sub: 'Help me scope an internal transcription bot.' },
    { title: 'AWS architecture', sub: 'Design a chat backend on Lambda + DynamoDB.' },
    { title: 'Review an approach', sub: 'Is this data model right for per-user history?' },
    { title: 'Debug something', sub: 'Walk through an error message with me.' },
  ],
  board: [
    { title: 'Submit an idea', sub: 'Turn my rough idea into a board-ready request.' },
    { title: 'Feature request', sub: 'Propose a new capability for the AI platform.' },
    { title: 'Process improvement', sub: 'Suggest an automation for a manual task.' },
    { title: 'Check status', sub: 'What happened to the idea I submitted?' },
  ],
};
