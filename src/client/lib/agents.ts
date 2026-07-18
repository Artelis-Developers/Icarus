/**
 * Agent catalogue for Icarus.
 *
 * `general` and `order` use browser → AgentCore HTTPS with Cognito JWT when
 * `NEXT_PUBLIC_HARNESS_ARN` / `NEXT_PUBLIC_HARNESS_ARN_ORDER` are set
 * (see src/client/lib/agentcore.ts); otherwise Amplify `/api/chat` (IAM InvokeHarness).
 * Unwired agents show a "coming soon" toast.
 *
 * Parked (re-add when ready): `dev` / `req_plan` → `/api/chat` IAM InvokeAgentRuntime
 * (runtime path + runtimeUserId still in server/api/chat/route.ts).
 */

export type AgentId = 'general' | 'order';

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
  { id: 'order', name: 'Order Agent', desc: 'Order products anywhere', color: '#5c7cfa', wired: true },
  // Parked — restore with AgentId + SUGGESTIONS + AgentIcon + RUNTIME_ENV_BY_AGENT:
  // { id: 'dev', name: 'Request Developer', desc: 'Scope and draft software requests', color: '#ffa94d', wired: true },
  // { id: 'req_plan', name: 'Request Planner', desc: 'Plan and break down requests', color: '#da77f2', wired: true },
];

export const DEFAULT_AGENT: AgentId = 'general';

/** Map legacy persisted ids to current agent ids. */
const LEGACY_AGENT_IDS: Record<string, AgentId> = {
  hr: 'order',
};

export function normalizeAgentId(id: string): AgentId {
  if (LEGACY_AGENT_IDS[id]) return LEGACY_AGENT_IDS[id];
  return AGENTS.some((a) => a.id === id) ? (id as AgentId) : DEFAULT_AGENT;
}

export function agentById(id: string): Agent {
  return AGENTS.find((a) => a.id === normalizeAgentId(id)) || AGENTS[0];
}

/** Suggestion starter cards shown on the empty state, per agent. */
export const SUGGESTIONS: Record<AgentId, { title: string; sub: string }[]> = {
  general: [
    { title: 'Summarise a meeting', sub: 'Paste a transcript and get key points & action items.' },
    { title: 'Draft an email', sub: 'Write a clear message to a colleague or customer.' },
    { title: 'Explain a process', sub: 'How do I request access to a system?' },
    { title: 'Which agent do I need?', sub: 'Not sure who can help — describe your question.' },
  ],
  order: [
    { title: 'Get address information', sub: 'Retrieve address information for a specific location.' },
    { title: 'Find a product', sub: 'Search for the right product for your client\'s needs.' },
    { title: 'Place an Order', sub: 'Place an order for a product or service.' },
    { title: 'Track an order', sub: 'Check the status of an existing order.' },
  ],
};
