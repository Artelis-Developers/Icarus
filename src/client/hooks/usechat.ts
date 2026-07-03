'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { streamChat, type ChatMessage } from '@/client/lib/stream';

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const send = useCallback(
    async (text: string) => {
      const userMsg: ChatMessage = { role: 'user', content: text };
      const allMessages = [...messages, userMsg];
      setMessages(allMessages);
      setLoading(true);

      // Add placeholder assistant message
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);
      let assistantText = '';

      await streamChat(
        allMessages,
        sessionId,
        (chunk) => {
          assistantText += chunk;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: assistantText };
            return updated;
          });
        },
        (errorMsg) => {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: errorMsg, isError: true };
            return updated;
          });
        },
        () => {}
      );

      setLoading(false);
    },
    [messages, sessionId]
  );

  return { messages, loading, send, scrollRef };
}
