/**
 * Streaming client for the /api/chat endpoint.
 * Handles SSE parsing, message state, and error recovery.
 */

import { authHeaders } from '@artelis/auth';

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
  const response = await fetch('/api/chat', {
    method: 'POST',
    // authHeaders() attaches the portal Cognito bearer so the withAuth-protected
    // route can verify it. Returns {} before the handshake / in standalone dev.
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
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
