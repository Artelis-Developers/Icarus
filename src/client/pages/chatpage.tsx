'use client';

import { useState } from 'react';
import { useChat } from '../hooks/usechat';
import { Sidebar } from '../components/sidebar';
import { TopBar } from '../components/topbar';
import { EmptyState } from '../components/emptystate';
import { MessageBubble } from '../components/messagebubble';
import { TypingIndicator } from '../components/typingindicator';
import { Composer } from '../components/composer';
import { WipToast } from '../components/wiptoast';
import { DebugPanel } from '../components/debugpanel';
import shell from '../styles/chatapp.module.css';

export default function ChatPage() {
  const {
    conversations,
    activeConv,
    activeId,
    currentAgentId,
    messages,
    isEmpty,
    agents,
    input,
    setInput,
    sending,
    collapsed,
    toasts,
    scrollRef,
    inputRef,
    send,
    newChat,
    openConversation,
    selectAgent,
    toggleSidebar,
    wip,
  } = useChat();

  // Raw wire capture is always recording; this only toggles the viewer.
  const [debugOpen, setDebugOpen] = useState(false);

  // Three-dot indicator shows while sending, before the first token lands
  // (the placeholder assistant message is still empty).
  const showTyping = sending && messages.length > 0 && messages[messages.length - 1].content === '';

  // While the dots show, drop the empty assistant placeholder so we don't render
  // a blank bubble next to the typing indicator.
  const visibleMessages = showTyping ? messages.slice(0, -1) : messages;

  const title = activeConv ? activeConv.title : 'New chat';

  return (
    <div className={shell.shell}>
      <Sidebar
        collapsed={collapsed}
        agents={agents}
        currentAgentId={currentAgentId}
        conversations={conversations}
        activeId={activeId}
        onNewChat={newChat}
        onSelectAgent={selectAgent}
        onOpenConversation={openConversation}
        onWip={wip}
      />

      <main className={shell.main}>
        <TopBar
          title={title}
          agentId={currentAgentId}
          onToggleSidebar={toggleSidebar}
          onWip={wip}
          debugOpen={debugOpen}
          onToggleDebug={() => setDebugOpen((v) => !v)}
        />

        <div className={shell.scroll}>
          {isEmpty ? (
            <EmptyState agentId={currentAgentId} onPick={(text) => setInput(text)} />
          ) : (
            <div className={shell.thread}>
              {visibleMessages.map((msg, i) => (
                <MessageBubble key={i} message={msg} agentId={currentAgentId} />
              ))}
              {showTyping && <TypingIndicator agentId={currentAgentId} />}
            </div>
          )}
          <div ref={scrollRef} />
        </div>

        <Composer
          value={input}
          onChange={setInput}
          onSubmit={() => send()}
          disabled={sending}
          agentId={currentAgentId}
          inputRef={inputRef}
          onWip={wip}
        />

        <WipToast toasts={toasts} />
      </main>

      <DebugPanel open={debugOpen} onClose={() => setDebugOpen(false)} />
    </div>
  );
}
