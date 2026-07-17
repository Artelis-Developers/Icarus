/**
 * AgentCore JWT invoke (browser → HTTPS) — only for selected agents.
 *
 * - `general` + `order`: Cognito Bearer → bedrock-agentcore …/runtimes/{arn}/invocations
 * - all other agents: unchanged Amplify `/api/chat` (IAM InvokeHarness)
 *
 * Client env (must be NEXT_PUBLIC_* to reach the browser):
 *   NEXT_PUBLIC_HARNESS_ARN       → general (JWT-enabled runtime ARN)
 *   NEXT_PUBLIC_HARNESS_ARN_ORDER → order
 *
 * Values should be the runtime ARN configured with a Cognito JWT authorizer
 * (`…:runtime/…`). Server-side `HARNESS_ARN*` remain for the /api/chat fallback.
 */

import type { AgentId } from '@/client/lib/agents';

/** Agents that use inbound JWT HTTPS instead of Amplify SSR. */
const JWT_INVOKE_AGENTS = new Set<AgentId>(['general', 'order']);

const JWT_ARN_ENV_BY_AGENT: Partial<Record<AgentId, string>> = {
  general: 'NEXT_PUBLIC_HARNESS_ARN',
  order: 'NEXT_PUBLIC_HARNESS_ARN_ORDER',
};

function env(name: string): string {
  return (process.env[name] || '').trim();
}

export function agentcoreRegion(): string {
  return (
    env('NEXT_PUBLIC_AGENTCORE_REGION') ||
    env('NEXT_PUBLIC_HARNESS_REGION') ||
    'eu-north-1'
  );
}

export function agentcoreQualifier(): string {
  return env('NEXT_PUBLIC_AGENTCORE_QUALIFIER') || 'DEFAULT';
}

export function isJwtInvokeAgent(agentId: string): boolean {
  return JWT_INVOKE_AGENTS.has((agentId || 'general') as AgentId);
}

/** ARN for JWT invoke, or empty if this agent is not on the JWT path / not configured. */
export function resolveJwtInvokeArn(agentId: string): string {
  const id = (agentId || 'general') as AgentId;
  if (!JWT_INVOKE_AGENTS.has(id)) return '';
  const key = JWT_ARN_ENV_BY_AGENT[id];
  return key ? env(key) : '';
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
