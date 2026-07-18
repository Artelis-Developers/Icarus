import { NextRequest } from 'next/server';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
  InvokeHarnessCommand,
} from '@aws-sdk/client-bedrock-agentcore';
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

/** Harness env var per UI agent — IAM InvokeHarness (general / order fallback). */
const HARNESS_ENV_BY_AGENT: Record<string, string> = {
  general: 'HARNESS_ARN',
  order: 'HARNESS_ARN_ORDER',
};

/** Runtime env var per UI agent — IAM InvokeAgentRuntime (dev / prioritizer / planner). */
const RUNTIME_ENV_BY_AGENT: Record<string, string> = {
  dev: 'RUNTIME_ARN_REQ_DEV',
  req_prio: 'RUNTIME_ARN_REQ_PRIO',
  req_plan: 'RUNTIME_ARN_REQ_PLAN',
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

function isRuntimeAgent(agentId?: string): boolean {
  return Boolean(agentId && RUNTIME_ENV_BY_AGENT[agentId]);
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

/**
 * Console sometimes copies ARNs with `/runtime-endpoint/DEFAULT` appended.
 * InvokeAgentRuntime wants the base `…:runtime/{id}` plus a separate `qualifier`.
 */
function parseRuntimeArn(raw: string): { agentRuntimeArn: string; qualifier?: string } {
  const trimmed = raw.trim();
  const marker = '/runtime-endpoint/';
  const idx = trimmed.indexOf(marker);
  if (idx === -1) {
    const qualifier = process.env.AGENTCORE_QUALIFIER?.trim() || undefined;
    return { agentRuntimeArn: trimmed, qualifier };
  }
  const agentRuntimeArn = trimmed.slice(0, idx);
  const qualifier = trimmed.slice(idx + marker.length).trim() || 'DEFAULT';
  return { agentRuntimeArn, qualifier };
}

function resolveRuntimeTarget(agentId?: string): { agentRuntimeArn: string; qualifier?: string } {
  const id = agentId || '';
  const envKey = RUNTIME_ENV_BY_AGENT[id];
  if (!envKey) {
    throw new Error(`No runtime mapping for agent "${id}"`);
  }
  const raw = process.env[envKey] || '';
  if (!raw) {
    throw new Error(`Runtime ARN not configured for agent "${id}" (set ${envKey})`);
  }
  const parsed = parseRuntimeArn(raw);
  if (!parsed.agentRuntimeArn.includes(':runtime/')) {
    throw new Error(
      `Expected a runtime ARN (…:runtime/…) for agent "${id}", got: ${parsed.agentRuntimeArn}`
    );
  }
  return parsed;
}

/** AgentCore requires runtimeSessionId length >= 33. */
function ensureSessionId(sessionId?: string): string {
  const sid = sessionId || crypto.randomUUID();
  if (sid.length >= 33) return sid;
  return `${sid}-${crypto.randomUUID()}`;
}

function lastUserPrompt(messages: { role: string; content: string }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
      return m.content.trim();
    }
  }
  throw new Error('No user message to send');
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
      'Agent timed out (~25s). Amplify SSR kills requests around 30s — ' +
      'agents that use tools often exceed this. ' +
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

/** Pull assistant text out of heterogeneous runtime JSON payloads. */
function extractRuntimeText(data: unknown, depth = 0): string | null {
  if (data == null || depth > 6) return null;
  if (typeof data === 'string') {
    const t = data.trim();
    if (!t || t === '[DONE]') return null;
    try {
      return extractRuntimeText(JSON.parse(t), depth + 1);
    } catch {
      return t;
    }
  }
  if (typeof data !== 'object') return null;

  const obj = data as Record<string, unknown>;

  if (typeof obj.error === 'string' && obj.error.trim()) return null; // handled by caller
  if (obj.type === 'error') return null;

  for (const key of ['text', 'answer', 'outputText', 'completion']) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v;
  }

  // Nested objects first (Strands: { message: { role, content: [{ text }] } })
  for (const key of ['message', 'content', 'output', 'response', 'result', 'event', 'data', 'body']) {
    const v = obj[key];
    if (v && typeof v === 'object') {
      const nested = extractRuntimeText(v, depth + 1);
      if (nested) return nested;
    }
    if (typeof v === 'string' && v.trim()) return v;
  }

  if (typeof obj.bytes === 'string' && obj.bytes) {
    try {
      return extractRuntimeText(Buffer.from(obj.bytes, 'base64').toString('utf8'), depth + 1);
    } catch {
      /* ignore */
    }
  }

  const delta = (obj as { contentBlockDelta?: { delta?: { text?: string } } }).contentBlockDelta
    ?.delta?.text;
  if (delta) return delta;

  if (Array.isArray(obj.messages)) {
    for (let i = obj.messages.length - 1; i >= 0; i--) {
      const nested = extractRuntimeText(obj.messages[i], depth + 1);
      if (nested) return nested;
    }
  }

  if (Array.isArray(obj.content)) {
    const parts: string[] = [];
    for (const block of obj.content) {
      const nested = extractRuntimeText(block, depth + 1);
      if (nested) parts.push(nested);
    }
    if (parts.length) return parts.join('');
  }

  return null;
}

function runtimeErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.error === 'string' && obj.error.trim()) return obj.error.trim();
  if (obj.type === 'error' && typeof obj.message === 'string') return obj.message;
  if (typeof obj.message === 'string' && /error|fail|denied/i.test(obj.message)) return obj.message;
  return null;
}

/**
 * Buffer InvokeAgentRuntime body into our SSE shape.
 * Runtime agents return a blob (JSON / SSE / plain text), not the harness event stream.
 * @see https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-invoke-agent.html
 */
async function collectRuntimeSse(
  command: InvokeAgentRuntimeCommand,
  agentId: string | undefined,
  signal: AbortSignal
): Promise<string> {
  const client = getClient();
  const response = await client.send(command, { abortSignal: signal });

  if (!response.response) {
    throw new Error('Runtime returned no response body (empty InvokeAgentRuntime response)');
  }

  if (signal.aborted) {
    const abortErr = new Error('Runtime timed out');
    abortErr.name = 'AbortError';
    throw abortErr;
  }

  const statusCode = response.statusCode ?? 200;
  const contentType = response.contentType || '';

  const body =
    typeof (response.response as { transformToString?: () => Promise<string> }).transformToString ===
    'function'
      ? await (response.response as { transformToString: () => Promise<string> }).transformToString()
      : await new Response(response.response as BodyInit).text();

  const lines: string[] = [];
  const trimmed = (body || '').trim();
  const preview = trimmed.slice(0, 400);

  console.log(
    `[chat] runtime agentId=${agentId ?? '(none)'} status=${statusCode} contentType=${contentType || '?'} bodyChars=${trimmed.length} preview=${JSON.stringify(preview)}`
  );

  if (statusCode >= 400) {
    lines.push(
      sseLine({
        type: 'error',
        message: `Runtime HTTP ${statusCode}: ${preview || '(empty body)'}`,
      })
    );
    lines.push('data: [DONE]\n\n');
    return lines.join('');
  }

  if (!trimmed) {
    lines.push(sseLine({ type: 'error', message: 'Runtime returned an empty body' }));
    lines.push('data: [DONE]\n\n');
    return lines.join('');
  }

  const finish = (emitted: boolean) => {
    if (!emitted) return false;
    lines.push(sseLine({ type: 'stop', reason: 'end_turn' }));
    lines.push('data: [DONE]\n\n');
    return true;
  };

  // text/event-stream (or any body with data: lines) — AWS sample treats each data line as content
  if (contentType.includes('text/event-stream') || trimmed.includes('data:')) {
    let emitted = false;
    for (const rawLine of trimmed.split(/\r?\n/)) {
      if (!rawLine.startsWith('data:')) continue;
      const payload = rawLine.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        const errMsg = runtimeErrorMessage(parsed);
        if (errMsg) {
          lines.push(sseLine({ type: 'error', message: errMsg }));
          emitted = true;
          continue;
        }
        if (parsed.type === 'text' && typeof parsed.text === 'string') {
          lines.push(sseLine({ type: 'text', text: parsed.text }));
          emitted = true;
          continue;
        }
        const text = extractRuntimeText(parsed);
        if (text) {
          lines.push(sseLine({ type: 'text', text }));
          emitted = true;
        } else {
          // Some agents put the utterance as the raw JSON line string fields we don't know —
          // fall back to the payload string only if it looks like prose, not a big object dump.
          if (!payload.startsWith('{') && !payload.startsWith('[')) {
            lines.push(sseLine({ type: 'text', text: payload }));
            emitted = true;
          }
        }
      } catch {
        lines.push(sseLine({ type: 'text', text: payload }));
        emitted = true;
      }
    }
    if (finish(emitted)) return lines.join('');
  }

  // NDJSON
  if (trimmed.includes('\n') && trimmed.split('\n').every((l) => !l.trim() || l.trim().startsWith('{'))) {
    let emitted = false;
    for (const line of trimmed.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try {
        const parsed = JSON.parse(t);
        const errMsg = runtimeErrorMessage(parsed);
        if (errMsg) {
          lines.push(sseLine({ type: 'error', message: errMsg }));
          emitted = true;
          continue;
        }
        const text = extractRuntimeText(parsed);
        if (text) {
          lines.push(sseLine({ type: 'text', text }));
          emitted = true;
        }
      } catch {
        /* ignore bad line */
      }
    }
    if (finish(emitted)) return lines.join('');
  }

  try {
    const parsed = JSON.parse(trimmed);
    const errMsg = runtimeErrorMessage(parsed);
    if (errMsg) {
      lines.push(sseLine({ type: 'error', message: errMsg }));
      lines.push('data: [DONE]\n\n');
      return lines.join('');
    }
    const text = extractRuntimeText(parsed);
    if (text) {
      lines.push(sseLine({ type: 'text', text }));
      finish(true);
      return lines.join('');
    }
  } catch {
    /* plain text */
  }

  // Plain text / unknown JSON — show it rather than a opaque streaming failure
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    lines.push(
      sseLine({
        type: 'error',
        message: `Runtime returned JSON we could not parse as assistant text: ${preview}`,
      })
    );
  } else {
    lines.push(sseLine({ type: 'text', text: trimmed }));
    lines.push(sseLine({ type: 'stop', reason: 'end_turn' }));
  }
  lines.push('data: [DONE]\n\n');
  return lines.join('');
}

function sseResponse(sseBody: string): Response {
  return new Response(sseBody, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

// withAuth verifies the portal Cognito JWT (JWKS + tenant directory lookup)
// before the agent is ever invoked — the trust boundary for this app, since
// there is no Lambda behind it. The verified identity (`_user`) isn't needed by
// the invoke itself; the point is that anonymous callers are rejected.
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

    const typedMessages = messages as { role: string; content: string }[];
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), AMPLIFY_SOFT_TIMEOUT_MS);

    try {
      if (isRuntimeAgent(agentId)) {
        let target: { agentRuntimeArn: string; qualifier?: string };
        try {
          target = resolveRuntimeTarget(agentId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: 400 });
        }

        const prompt = lastUserPrompt(typedMessages);
        console.log(
          `[chat] agentId=${agentId} → runtime=${target.agentRuntimeArn.split('/').pop()}` +
            (target.qualifier ? ` qualifier=${target.qualifier}` : '')
        );

        const command = new InvokeAgentRuntimeCommand({
          agentRuntimeArn: target.agentRuntimeArn,
          qualifier: target.qualifier,
          runtimeSessionId: ensureSessionId(sessionId),
          contentType: 'application/json',
          // Prefer event-stream when the agent supports it; JSON still accepted.
          accept: 'text/event-stream, application/json',
          payload: new TextEncoder().encode(JSON.stringify({ prompt })),
        });

        const sseBody = await collectRuntimeSse(command, agentId, ac.signal);
        return sseResponse(sseBody);
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

      const harnessMessages = typedMessages.map((m) => ({
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

      const sseBody = await collectHarnessSse(command, agentId, ac.signal);
      return sseResponse(sseBody);
    } catch (err) {
      const msg = formatInvokeError(err);
      console.error(`[chat] invoke failed agentId=${agentId ?? '(none)'}:`, err);
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
