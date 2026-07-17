/**
 * AgentCore harness JWT invoke (browser → HTTPS) — only for selected agents.
 *
 * Harness-managed agents cannot use /runtimes/.../invocations. Use InvokeHarness:
 *   POST /harnesses/invoke?harnessArn=...  + Authorization: Bearer <Cognito JWT>
 *
 * - `general` + `order`: JWT → InvokeHarness
 * - all other agents: Amplify `/api/chat` (IAM InvokeHarness)
 *
 * NEXT_PUBLIC_HARNESS_ARN* must be **harness** ARNs (`…:harness/…`), not runtime ARNs.
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

/** Harness ARN for JWT InvokeHarness, or empty if not on the JWT path / not configured. */
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
 * POST https://bedrock-agentcore.{region}.amazonaws.com/harnesses/invoke?harnessArn=…&qualifier=…
 * @see https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/API_InvokeHarness.html
 */
export function buildHarnessInvokeUrl(harnessArn: string): string {
  const region = agentcoreRegion();
  const params = new URLSearchParams({
    harnessArn,
    qualifier: agentcoreQualifier(),
  });
  return `https://bedrock-agentcore.${region}.amazonaws.com/harnesses/invoke?${params.toString()}`;
}

/** AgentCore requires session ids between 33 and 256 characters. */
export function ensureRuntimeSessionId(sessionId: string): string {
  let sid = (sessionId || '').trim();
  if (!sid) sid = `sess-${crypto.randomUUID()}`;
  if (sid.length < 33) sid = `${sid}-${crypto.randomUUID()}`;
  if (sid.length > 256) sid = sid.slice(0, 256);
  return sid;
}
