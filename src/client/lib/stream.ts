/**
 * Streaming client for chat.
 *
 * Production path (when NEXT_PUBLIC_RUNTIME_ARN_* is set): browser → AgentCore HTTPS
 * with Cognito Bearer JWT (inbound auth). No Amplify SSR, no SigV4 SDK.
 *
 * Fallback: POST /api/chat (local / until runtimes are JWT-configured).
 */

import { getPortalAuth, STORAGE_KEYS } from '@artelis/auth';
import {
  buildHarnessInvokeUrl,
  ensureRuntimeSessionId,
  isJwtInvokeAgent,
  resolveJwtInvokeArn,
  useAgentcoreJwtInvoke,
} from '@/client/lib/agentcore';

/**
 * Resolve the portal Cognito access token for the Authorization header, trying
 * three sources in order (fleet convention — mirrors Products' resolveAccessToken):
 *   1. getPortalAuth().getJWTToken()   — the client's held JWT
 *   2. getPortalAuth().getAccessToken()
 *   3. sessionStorage 'portal_tokens'  — the raw handshake payload
 *
 * Tier 3 is the one that matters INSIDE the portal iframe: the in-memory
 * getPortalAuth() singleton is frequently unreachable there even though the
 * portal DID deliver a token, so a singleton-only helper (@artelis/auth's
 * authHeaders) sends no header and the withAuth route 401s despite the user
 * being authenticated. Reading sessionStorage recovers the token.
 */
function resolveAccessToken(): string | null {
  const portal = getPortalAuth();
  const fromClient = portal?.getJWTToken() ?? portal?.getAccessToken() ?? null;
  if (fromClient) return fromClient;

  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEYS.tokens);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { access_token?: string };
    return parsed.access_token ?? null;
  } catch {
    return null;
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
}

interface StreamEvent {
  type: 'text' | 'stop' | 'metadata' | 'error' | 'status';
  text?: string;
  reason?: string;
  message?: string;
  usage?: Record<string, number>;
}

function detailFromJson(json: unknown): string | null {
  if (json == null) return null;
  if (typeof json === 'string') return json;
  if (typeof json !== 'object') return String(json);

  const obj = json as Record<string, unknown>;
  for (const key of ['message', 'Message', 'error', 'Error', 'msg']) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object') {
      const nested = detailFromJson(v);
      if (nested) return nested;
    }
  }
  try {
    return JSON.stringify(json);
  } catch {
    return null;
  }
}

/** Prefer server `{ error }` / `{ message }`, else a short body snippet, else status. */
async function formatHttpError(response: Response): Promise<string> {
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  let body = '';
  try {
    body = (await response.text()).trim();
  } catch {
    /* ignore */
  }

  if (body) {
    console.warn('[chat] HTTP error body', status, body.slice(0, 500));
    try {
      const detail = detailFromJson(JSON.parse(body));
      if (detail) return `${status}: ${detail}`;
    } catch {
      /* not JSON */
    }
    const snippet = body.length > 280 ? `${body.slice(0, 280)}…` : body;
    return `${status}: ${snippet}`;
  }

  return `${status}: Failed to connect to agent (empty response)`;
}

/** Pull assistant text out of heterogeneous AgentCore / SSE JSON payloads. */
function extractTextFromPayload(data: unknown): string | null {
  if (data == null) return null;
  if (typeof data === 'string') {
    const t = data.trim();
    if (!t || t === '[DONE]') return null;
    try {
      return extractTextFromPayload(JSON.parse(t));
    } catch {
      return t;
    }
  }
  if (typeof data !== 'object') return null;

  const obj = data as Record<string, unknown>;

  // Our legacy /api/chat SSE shape
  if (obj.type === 'text' && typeof obj.text === 'string') return obj.text;
  if (obj.type === 'error') return null;

  if (typeof obj.text === 'string' && obj.text) return obj.text;
  if (typeof obj.message === 'string' && obj.message) return obj.message;
  if (typeof obj.content === 'string' && obj.content) return obj.content;

  // InvokeAgentRuntime often wraps bytes (base64) or nested event
  if (typeof obj.bytes === 'string' && obj.bytes) {
    try {
      const decoded = atob(obj.bytes);
      return extractTextFromPayload(decoded);
    } catch {
      /* ignore */
    }
  }

  if (obj.event && typeof obj.event === 'object') {
    return extractTextFromPayload(obj.event);
  }

  const delta = (obj as { contentBlockDelta?: { delta?: { text?: string } } }).contentBlockDelta
    ?.delta?.text;
  if (delta) return delta;

  // Strands / message list shapes
  if (Array.isArray(obj.message)) {
    const parts: string[] = [];
    for (const part of obj.message) {
      if (part && typeof part === 'object' && typeof (part as { text?: string }).text === 'string') {
        parts.push((part as { text: string }).text);
      }
    }
    if (parts.length) return parts.join('');
  }

  return null;
}

function handleSseDataLine(
  data: string,
  onText: (chunk: string) => void,
  onError: (msg: string) => void,
  onStatus?: (msg: string) => void
): 'done' | 'continue' {
  const trimmed = data.trim();
  if (!trimmed) return 'continue';
  if (trimmed === '[DONE]') return 'done';

  try {
    const evt = JSON.parse(trimmed) as StreamEvent & Record<string, unknown>;
    if (evt.type === 'error') {
      onError(evt.message || 'Unknown error');
      return 'continue';
    }
    if (evt.type === 'status' && evt.message) {
      onStatus?.(evt.message);
      return 'continue';
    }
    if (evt.type === 'stop' || evt.type === 'metadata') return 'continue';

    const text = extractTextFromPayload(evt);
    if (text) onText(text);
  } catch {
    // Non-JSON SSE data — treat as plain text token
    onText(trimmed);
  }
  return 'continue';
}

/** Amplify /api/chat SSE (`data: {...}`). */
async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onText: (chunk: string) => void,
  onError: (msg: string) => void,
  onDone: () => void,
  onStatus?: (msg: string) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed || trimmed.startsWith(':')) continue;

      if (trimmed.startsWith('data:')) {
        const data = trimmed.slice(5).trimStart();
        if (handleSseDataLine(data, onText, onError, onStatus) === 'done') {
          onDone();
          return;
        }
        continue;
      }

      if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
        const text = extractTextFromPayload(trimmed);
        if (text) onText(text);
      }
    }
  }

  if (buffer.trim()) {
    const leftover = buffer.trim();
    if (leftover.startsWith('data:')) {
      handleSseDataLine(leftover.slice(5).trimStart(), onText, onError, onStatus);
    } else {
      const text = extractTextFromPayload(leftover);
      if (text) onText(text);
    }
  }

  onDone();
}

/**
 * InvokeHarness HTTPS returns AWS event-stream (binary framing + embedded JSON).
 * Decode as UTF-8 so agent text (dashes, accents) is correct; scan for delta.text.
 */
async function readAwsEventStream(
  body: ReadableStream<Uint8Array>,
  onText: (chunk: string) => void,
  onError: (msg: string) => void,
  onDone: () => void,
  onStatus?: (msg: string) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let gotText = false;

  /** Bytes misread as latin1 → proper UTF-8 (fallback if a chunk was already mojibake). */
  const asUtf8 = (s: string): string => {
    if (!/[\u0080-\u00ff]/.test(s)) return s;
    try {
      const bytes = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return s;
    }
  };

  const emitDeltaTexts = () => {
    const deltaRe = /"delta"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let match: RegExpExecArray | null;
    let consumed = 0;

    while ((match = deltaRe.exec(buffer)) !== null) {
      try {
        // Same decoding as JSON.stringify/parse on /api/chat SSE text events
        let text = JSON.parse(`"${match[1]}"`) as string;
        text = asUtf8(text).replace(/\r\n/g, '\n');
        if (text) {
          if (!gotText) console.info('[chat] first contentBlockDelta text received');
          gotText = true;
          onText(text);
        }
      } catch {
        /* skip bad escape */
      }
      consumed = match.index + match[0].length;
    }

    // Only real harness failures — do not treat other "message" fields as errors
    // (that would flip the bubble to error styling and skip markdown).
    if (!gotText) {
      const errRe =
        /"runtimeClientError"\s*:\s*\{[^}]*?"message"\s*:\s*"((?:[^"\\]|\\.)*)"/;
      const errMatch = errRe.exec(buffer);
      if (errMatch?.[1]) {
        try {
          onError(asUtf8(JSON.parse(`"${errMatch[1]}"`) as string));
        } catch {
          onError(asUtf8(errMatch[1]));
        }
      }
    }

    const toolRe = /"toolUse"\s*:\s*\{\s*"name"\s*:\s*"((?:[^"\\]|\\.)*)"/;
    const toolMatch = toolRe.exec(buffer);
    if (toolMatch?.[1] && !gotText) {
      try {
        onStatus?.(`Using tool: ${JSON.parse(`"${toolMatch[1]}"`)}`);
      } catch {
        onStatus?.(`Using tool: ${toolMatch[1]}`);
      }
    }

    const lastDelta = buffer.lastIndexOf('"delta"');
    if (lastDelta >= consumed) {
      buffer = buffer.slice(lastDelta);
    } else if (consumed > 0) {
      buffer = buffer.slice(consumed);
    } else if (buffer.length > 64_000) {
      buffer = buffer.slice(-1024);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    buffer += decoder.decode(value, { stream: true });
    emitDeltaTexts();
  }

  buffer += decoder.decode();
  emitDeltaTexts();

  if (!gotText) {
    console.warn('[chat] InvokeHarness stream ended with no text deltas');
    onError('Agent stream finished with no text (event-stream parse found no delta.text)');
  }
  onDone();
}

async function streamViaAgentcoreJwt(
  messages: ChatMessage[],
  sessionId: string,
  agentId: string,
  token: string,
  onText: (chunk: string) => void,
  onError: (msg: string) => void,
  onDone: () => void,
  onStatus?: (msg: string) => void
): Promise<void> {
  const harnessArn = resolveJwtInvokeArn(agentId);
  if (!harnessArn) {
    onError(
      `JWT invoke ARN not configured for agent "${agentId}" (set NEXT_PUBLIC_HARNESS_ARN or NEXT_PUBLIC_HARNESS_ARN_ORDER)`
    );
    return;
  }

  if (!harnessArn.includes(':harness/')) {
    onError(
      `Expected a harness ARN (…:harness/…), got runtime ARN. Use HARNESS_ARN values for NEXT_PUBLIC_HARNESS_ARN*, not runtime/…`
    );
    return;
  }

  // Session stickiness already keeps conversation state in the harness microVM.
  // Resending full history every turn inflates input tokens and makes JWT feel slow.
  const lastUser = [...messages].reverse().find((m) => m.role === 'user' && !m.isError && m.content.trim());
  if (!lastUser) {
    onError('No user message to send');
    return;
  }
  const harnessMessages = [
    {
      role: 'user' as const,
      content: [{ text: lastUser.content }],
    },
  ];

  const url = buildHarnessInvokeUrl(harnessArn);
  const runtimeSessionId = ensureRuntimeSessionId(sessionId);

  if (typeof console !== 'undefined') {
    console.info('[AgentCore JWT] invoke', {
      agentId,
      sessionChars: runtimeSessionId.length,
      promptChars: lastUser.content.length,
      historySkipped: messages.length - 1,
    });
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': runtimeSessionId,
      },
      body: JSON.stringify({ messages: harnessMessages }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onError(`Network error: ${msg}`);
    return;
  }

  if (!response.ok || !response.body) {
    onError(await formatHttpError(response));
    return;
  }

  console.info('[chat] InvokeHarness response', {
    status: response.status,
    contentType: response.headers.get('content-type'),
  });
  // Always AWS event-stream for Bearer InvokeHarness (not Amplify SSE).
  await readAwsEventStream(response.body, onText, onError, onDone, onStatus);
}

async function streamViaApiChat(
  messages: ChatMessage[],
  sessionId: string,
  agentId: string,
  token: string | null,
  onText: (chunk: string) => void,
  onError: (msg: string) => void,
  onDone: () => void,
  onStatus?: (msg: string) => void
): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ messages, sessionId, agentId }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onError(`Network error: ${msg}`);
    return;
  }

  if (!response.ok || !response.body) {
    onError(await formatHttpError(response));
    return;
  }

  await readSseStream(response.body, onText, onError, onDone, onStatus);
}

export async function streamChat(
  messages: ChatMessage[],
  sessionId: string,
  agentId: string,
  onText: (chunk: string) => void,
  onError: (msg: string) => void,
  onDone: () => void,
  onStatus?: (msg: string) => void
): Promise<void> {
  const token = resolveAccessToken();

  if (useAgentcoreJwtInvoke(agentId)) {
    const arn = resolveJwtInvokeArn(agentId);
    const url = arn ? buildHarnessInvokeUrl(arn) : '(missing ARN)';
    let tokenIss: string | undefined;
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
        tokenIss = typeof payload.iss === 'string' ? payload.iss : undefined;
      } catch {
        /* ignore */
      }
    }
    console.info('[chat] path=AgentCore JWT InvokeHarness', {
      agentId,
      url,
      harnessArn: arn,
      sessionId: ensureRuntimeSessionId(sessionId),
      hasToken: Boolean(token),
      tokenIss,
    });
    if (!token) {
      onError('Not signed in — Cognito access token required to invoke the agent');
      return;
    }
    await streamViaAgentcoreJwt(
      messages,
      sessionId,
      agentId,
      token,
      onText,
      onError,
      onDone,
      onStatus
    );
    return;
  }

  if (isJwtInvokeAgent(agentId)) {
    console.warn(
      '[chat] path=Amplify /api/chat — JWT agent but NEXT_PUBLIC_HARNESS_ARN* missing in this build. Set env on Amplify and redeploy.',
      { agentId }
    );
  } else {
    console.info('[chat] path=Amplify /api/chat (IAM harness or runtime)', {
      agentId,
      sessionId,
      hasToken: Boolean(token),
    });
  }
  await streamViaApiChat(messages, sessionId, agentId, token, onText, onError, onDone, onStatus);
}
