/**
 * AgentCore JWT invoke (browser → HTTPS) — only for selected agents.
 *
 * - `general` + `order`: Cognito Bearer → bedrock-agentcore …/runtimes/{arn}/invocations
 * - all other agents: unchanged Amplify `/api/chat` (IAM InvokeHarness)
 *
 * IMPORTANT: Next.js only inlines `process.env.NEXT_PUBLIC_*` with static property
 * access. Never use process.env[dynamicKey] — it is always undefined in the browser.
 */

import type { AgentId } from '@/client/lib/agents';

/** Agents that use inbound JWT HTTPS instead of Amplify SSR. */
const JWT_INVOKE_AGENTS = new Set<AgentId>(['general', 'order']);

export function agentcoreRegion(): string {
  return (
    process.env.NEXT_PUBLIC_AGENTCORE_REGION?.trim() ||
    process.env.NEXT_PUBLIC_HARNESS_REGION?.trim() ||
    'eu-north-1'
  );
}

export function agentcoreQualifier(): string {
  return process.env.NEXT_PUBLIC_AGENTCORE_QUALIFIER?.trim() || 'DEFAULT';
}

export function isJwtInvokeAgent(agentId: string): boolean {
  return JWT_INVOKE_AGENTS.has((agentId || 'general') as AgentId);
}

/** ARN for JWT invoke, or empty if this agent is not on the JWT path / not configured. */
export function resolveJwtInvokeArn(agentId: string): string {
  const id = (agentId || 'general') as AgentId;
  if (!JWT_INVOKE_AGENTS.has(id)) return '';

  if (id === 'general') {
    return process.env.NEXT_PUBLIC_HARNESS_ARN?.trim() || '';
  }
  if (id === 'order') {
    return process.env.NEXT_PUBLIC_HARNESS_ARN_ORDER?.trim() || '';
  }
  return '';
}

/** True when this agent should call AgentCore HTTPS with Cognito JWT (not /api/chat). */
export function useAgentcoreJwtInvoke(agentId: string): boolean {
  return Boolean(resolveJwtInvokeArn(agentId));
}

/**
 * POST https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{encodedArn}/invocations?qualifier=…
 */
export function buildInvocationUrl(runtimeArn: string): string {
  const region = agentcoreRegion();
  const qualifier = encodeURIComponent(agentcoreQualifier());
  const encodedArn = encodeURIComponent(runtimeArn);
  return `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodedArn}/invocations?qualifier=${qualifier}`;
}

/** AgentCore requires session ids between 33 and 256 characters. */
export function ensureRuntimeSessionId(sessionId: string): string {
  let sid = (sessionId || '').trim();
  if (!sid) sid = `sess-${crypto.randomUUID()}`;
  if (sid.length < 33) sid = `${sid}-${crypto.randomUUID()}`;
  if (sid.length > 256) sid = sid.slice(0, 256);
  return sid;
}
