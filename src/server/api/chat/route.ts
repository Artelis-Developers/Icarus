import { NextRequest } from 'next/server';
import { BedrockAgentCoreClient, InvokeHarnessCommand } from '@aws-sdk/client-bedrock-agentcore';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { withAuth } from '@artelis/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Amplify Hosting SSR compute hard-caps around ~30s (maxDuration here does not raise it).
 * Keep aligned with that platform limit.
 */
export const maxDuration = 30;

const REGION = process.env.HARNESS_REGION || 'eu-north-1';
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'eu.amazon.nova-pro-v1:0';

/** Leave headroom under Amplify's ~30s kill so we can return a JSON body instead of an empty 500. */
const AMPLIFY_SOFT_TIMEOUT_MS = 25_000;

// Set only in a cross-account frontend (e.g. prod Amplify in a separate account).
// When empty, the client uses its own ambient identity — the same-account behaviour.
const AGENT_INVOKE_ROLE_ARN = process.env.AGENT_INVOKE_ROLE_ARN || '';
const AGENT_INVOKE_EXTERNAL_ID = process.env.AGENT_INVOKE_EXTERNAL_ID || 'agenticcore-prod';

/** Env var name per UI agent id — resolved at request time (not module load). */
const HARNESS_ENV_BY_AGENT: Record<string, string> = {
  general: 'HARNESS_ARN',
  order: 'HARNESS_ARN_ORDER',
};

function getClient() {
  // Same account: no role to assume — use the ambient compute-role credentials.
  if (!AGENT_INVOKE_ROLE_ARN) {
    return new BedrockAgentCoreClient({ region: REGION });
  }
  // Cross account: assume the invoke role in the agent account first, then act as it.
  return new BedrockAgentCoreClient({
    region: REGION,
    credentials: fromTemporaryCredentials({
      params: {
        RoleArn: AGENT_INVOKE_ROLE_ARN,
        RoleSessionName: 'agenticcore-prod-frontend',
        ExternalId: AGENT_INVOKE_EXTERNAL_ID,
        DurationSeconds: 3600,
      },
    }),
  });
}

function resolveHarnessArn(agentId?: string): string {
  const id = agentId || 'general';
  const envKey = HARNESS_ENV_BY_AGENT[id];

  // Known agent → must have its own ARN. Never silently fall back to general
  // (empty string used to be falsy and always routed to HARNESS_ARN).
  if (envKey) {
    const arn = process.env[envKey] || '';
    if (!arn) {
      throw new Error(`Harness ARN not configured for agent "${id}" (set ${envKey})`);
    }
    return arn;
  }

  const fallback = process.env.HARNESS_ARN || '';
  if (!fallback) {
    throw new Error(`No harness configured for agent "${id}"`);
  }
  return fallback;
}

/** AgentCore requires runtimeSessionId length >= 33. */
function ensureSessionId(sessionId?: string): string {
  const sid = sessionId || crypto.randomUUID();
  if (sid.length >= 33) return sid;
  return `${sid}-${crypto.randomUUID()}`;
}

/** Pull a useful message from AWS SDK / generic errors for logs + the client. */
function formatInvokeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  const parts = [err.name !== 'Error' ? err.name : null, err.message].filter(Boolean);
  const aws = err as Error & {
    Code?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number; requestId?: string };
    name?: string;
  };
  const code = aws.Code || aws.code;
  if (code && !parts.includes(code)) parts.push(`code=${code}`);
  if (aws.$metadata?.httpStatusCode) parts.push(`http=${aws.$metadata.httpStatusCode}`);
  if (aws.$metadata?.requestId) parts.push(`requestId=${aws.$metadata.requestId}`);

  const name = err.name || '';
  if (name === 'AbortError' || /aborted/i.test(err.message)) {
    return (
      'Harness timed out (~25s). Amplify SSR kills requests around 30s — ' +
      'agents that use the browser tool often exceed this. ' +
      parts.join(' — ')
    );
  }
  return parts.join(' — ');
}

type HarnessStreamEvent = {
  contentBlockDelta?: { delta?: { text?: string; toolUse?: { input?: string } } };
  contentBlockStart?: { start?: { toolUse?: { name?: string; toolUseId?: string } } };
  messageStop?: { stopReason?: string };
  metadata?: { usage?: Record<string, number> };
  runtimeClientError?: { message?: string };
  internalServerException?: { message?: string };
  validationException?: { message?: string };
  modelStreamErrorException?: { message?: string };
  throttlingException?: { message?: string };
  serviceUnavailableException?: { message?: string };
};

const FAIL_STOP_REASONS = new Set([
  'max_tokens',
  'max_iterations_exceeded',
  'timeout_exceeded',
  'max_output_tokens_exceeded',
  'tool_use', // inline tool — this app doesn't round-trip tool results
]);

function streamEventError(event: HarnessStreamEvent): string | null {
  const candidates: Array<{ key: string; payload?: { message?: string } }> = [
    { key: 'runtimeClientError', payload: event.runtimeClientError },
    { key: 'internalServerException', payload: event.internalServerException },
    { key: 'validationException', payload: event.validationException },
    { key: 'modelStreamErrorException', payload: event.modelStreamErrorException },
    { key: 'throttlingException', payload: event.throttlingException },
    { key: 'serviceUnavailableException', payload: event.serviceUnavailableException },
  ];
  for (const { key, payload } of candidates) {
    if (!payload) continue;
    return payload.message ? `${key}: ${payload.message}` : key;
  }
  return null;
}

function sseLine(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Amplify Hosting does not support Next.js streaming responses.
 * Buffer the harness event stream into one SSE body so the client parser still works,
 * and failures can return JSON with a real error message instead of an empty 500.
 */
async function collectHarnessSse(
  command: InvokeHarnessCommand,
  agentId: string | undefined,
  signal: AbortSignal
): Promise<string> {
  const client = getClient();
  const response = await client.send(command, { abortSignal: signal });

  if (!response.stream) {
    throw new Error('Harness returned no stream (empty InvokeHarness response)');
  }

  const lines: string[] = [];

  for await (const event of response.stream as AsyncIterable<HarnessStreamEvent>) {
    if (signal.aborted) {
      const abortErr = new Error('Harness timed out');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    const streamErr = streamEventError(event);
    if (streamErr) {
      console.error(`[chat] harness stream error agentId=${agentId ?? '(none)'}:`, streamErr);
      lines.push(sseLine({ type: 'error', message: streamErr }));
      continue;
    }

    const toolName = event.contentBlockStart?.start?.toolUse?.name;
    if (toolName) {
      lines.push(sseLine({ type: 'status', message: `Using tool: ${toolName}` }));
    }

    if (event.contentBlockDelta) {
      const delta = event.contentBlockDelta.delta;
      if (delta?.text) {
        lines.push(sseLine({ type: 'text', text: delta.text }));
      }
    } else if (event.messageStop) {
      const reason = event.messageStop.stopReason || '';
      lines.push(sseLine({ type: 'stop', reason }));
      if (FAIL_STOP_REASONS.has(reason)) {
        const msg =
          reason === 'tool_use'
            ? 'Harness stopped for an inline tool result (not supported by this app)'
            : `Harness stopped early (${reason})`;
        lines.push(sseLine({ type: 'error', message: msg }));
      }
    } else if (event.metadata) {
      lines.push(sseLine({ type: 'metadata', usage: event.metadata.usage }));
    }
  }

  lines.push('data: [DONE]\n\n');
  return lines.join('');
}

// withAuth verifies the portal Cognito JWT (JWKS + tenant directory lookup)
// before the harness is ever invoked — the trust boundary for this app, since
// there is no Lambda behind it. The verified identity (`_user`) isn't needed by
// the harness call itself; the point is that anonymous callers are rejected.
export const POST = withAuth(async (req: NextRequest, _user) => {
  try {
    let body: { messages?: unknown; sessionId?: string; agentId?: string };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { messages, sessionId, agentId } = body;

    if (!messages || !Array.isArray(messages)) {
      return Response.json({ error: 'messages array required' }, { status: 400 });
    }

    let harnessArn: string;
    try {
      harnessArn = resolveHarnessArn(agentId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: msg }, { status: 400 });
    }

    console.log(
      `[chat] agentId=${agentId ?? '(none)'} → harness=${harnessArn.split('/').pop()}`
    );

    const harnessMessages = messages.map((m: { role: string; content: string }) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: [{ text: m.content }],
    }));

    const command = new InvokeHarnessCommand({
      harnessArn,
      runtimeSessionId: ensureSessionId(sessionId),
      messages: harnessMessages,
      model: {
        bedrockModelConfig: {
          modelId: MODEL_ID,
        },
      },
    });

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), AMPLIFY_SOFT_TIMEOUT_MS);

    try {
      const sseBody = await collectHarnessSse(command, agentId, ac.signal);
      return new Response(sseBody, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    } catch (err) {
      const msg = formatInvokeError(err);
      console.error(`[chat] harness invoke failed agentId=${agentId ?? '(none)'}:`, err);
      const aborted =
        (err instanceof Error && err.name === 'AbortError') ||
        (err instanceof Error && /aborted|timed out/i.test(err.message));
      return Response.json({ error: msg }, { status: aborted ? 504 : 502 });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const msg = formatInvokeError(err);
    console.error('[chat] unhandled error:', err);
    return Response.json({ error: msg }, { status: 500 });
  }
});
