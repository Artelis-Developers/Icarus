/**
 * Streaming client for the /api/chat endpoint.
 * Handles SSE parsing, message state, and error recovery.
 */

import { getPortalAuth, STORAGE_KEYS } from '@artelis/auth';

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
  type: 'text' | 'stop' | 'metadata' | 'error';
  text?: string;
  reason?: string;
  message?: string;
  usage?: Record<string, number>;
}

export async function streamChat(
  messages: ChatMessage[],
  sessionId: string,
  agentId: string,
  onText: (chunk: string) => void,
  onError: (msg: string) => void,
  onDone: () => void
): Promise<void> {
  const token = resolveAccessToken();
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Portal Cognito bearer so the withAuth-protected route accepts the call.
      // Omitted (no token) before the handshake or in standalone dev.
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, sessionId, agentId }),
  });

  if (!response.ok || !response.body) {
    onError('Failed to connect to harness');
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        onDone();
        return;
      }

      try {
        const evt: StreamEvent = JSON.parse(data);
        if (evt.type === 'text' && evt.text) {
          onText(evt.text);
        } else if (evt.type === 'error') {
          onError(evt.message || 'Unknown error');
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  onDone();
}
