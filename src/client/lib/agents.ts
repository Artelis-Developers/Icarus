/**
 * Agent catalogue for Ikairus.
 *
 * Only the "general" agent is wired to the live /api/chat backend right now.
 * Selecting any other agent triggers a WIP toast (see chatpage / useChat) and
 * keeps the active agent on "general". The metadata below (colors, icons,
 * suggestions) still drives the sidebar so the full roster is visible.
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
  { id: 'hr', name: 'HR Bot', desc: 'Salary, vacation & policies', color: '#5c7cfa', wired: false },
  { id: 'dev', name: 'Dev Bot', desc: 'Software ideas & engineering', color: '#ffa94d', wired: false },
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
    { title: 'Vacation balance', sub: 'How many days off do I have left this year?' },
    { title: 'Salary question', sub: 'When is the next payroll run?' },
    { title: 'Parental leave', sub: 'What is the policy and how do I apply?' },
    { title: 'Sick day', sub: 'How do I report an absence correctly?' },
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
