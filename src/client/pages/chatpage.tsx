'use client';

import { useChat } from '@/client/hooks/usechat';
import { ChatHeader } from '@/client/components/chatheader';
import { MessageBubble } from '@/client/components/messagebubble';
import { TypingIndicator } from '@/client/components/typingindicator';
import { ChatInput } from '@/client/components/chatinput';
import { EmptyState } from '@/client/components/emptystate';
import styles from '@/client/styles/chatapp.module.css';

export default function ChatPage() {
  const { messages, loading, send, scrollRef } = useChat();

  const isEmpty = messages.length === 0;
  const showTyping = loading && messages.length > 0 && messages[messages.length - 1].content === '';

  return (
    <div className={styles.app}>
      <ChatHeader />

      <div className={styles.messages}>
        {isEmpty && <EmptyState />}
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        {showTyping && <TypingIndicator />}
        <div ref={scrollRef} />
      </div>

      <ChatInput onSend={send} disabled={loading} />
    </div>
  );
}
