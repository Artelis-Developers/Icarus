'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { streamChat, type ChatMessage } from '@/client/lib/stream';
import { loadJSON, saveJSON } from '@/client/lib/storage';
import { AGENTS, DEFAULT_AGENT, agentById, normalizeAgentId, type AgentId } from '@/client/lib/agents';

const STORAGE_KEY = 'Icarus.v2';

export interface Conversation {
  id: string;
  /** Stable AgentCore runtimeSessionId for this conversation. */
  sessionId: string;
  agentId: AgentId;
  title: string;
  messages: ChatMessage[];
}

interface PersistedState {
  conversations: Conversation[];
  activeId: string;
  draftAgentId: AgentId;
}

interface WipToast {
  id: number;
  label: string;
}

function uid(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}-${rand}`;
}

export function useChat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>('new');
  const [draftAgentId, setDraftAgentId] = useState<AgentId>(DEFAULT_AGENT);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [toasts, setToasts] = useState<WipToast[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toastSeq = useRef(0);
  const hydrated = useRef(false);
  const draftAgentIdRef = useRef<AgentId>(draftAgentId);
  draftAgentIdRef.current = draftAgentId;

  /* ── Hydrate from storage once ── */
  useEffect(() => {
    const s = loadJSON<PersistedState | null>(STORAGE_KEY, null);
    if (s && Array.isArray(s.conversations)) {
      setActiveId(s.activeId || 'new');
      setDraftAgentId(normalizeAgentId(s.draftAgentId || DEFAULT_AGENT));
      setConversations(
        s.conversations.map((c) => ({
          ...c,
          agentId: normalizeAgentId(c.agentId),
        }))
      );
    }
    hydrated.current = true;
  }, []);

  /* ── Persist on change (after hydration) ── */
  useEffect(() => {
    if (!hydrated.current) return;
    saveJSON(STORAGE_KEY, { conversations, activeId, draftAgentId } satisfies PersistedState);
  }, [conversations, activeId, draftAgentId]);

  /* ── Derived ── */
  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId]
  );
  const currentAgentId: AgentId = activeConv ? activeConv.agentId : draftAgentId;
  const messages = activeConv ? activeConv.messages : [];
  const isEmpty = messages.length === 0;

  /* ── Scroll to bottom on new content ── */
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  /* ── WIP toast ── */
  const wip = useCallback((label: string) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, label }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2500);
  }, []);

  /* ── Navigation / selection ── */
  const newChat = useCallback(() => {
    setActiveId('new');
    setInput('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const openConversation = useCallback((id: string) => {
    setActiveId(id);
    setInput('');
  }, []);

  const toggleSidebar = useCallback(() => setCollapsed((c) => !c), []);

  const selectAgent = useCallback(
    (id: AgentId) => {
      const agent = agentById(id);
      if (!agent.wired) {
        wip(`${agent.name} — coming soon`);
        return;
      }

      // Fresh draft for this agent already — no need to reset.
      if (activeId === 'new' && draftAgentId === id) return;

      setActiveId('new');
      setDraftAgentId(id);
      setInput('');
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [wip, activeId, draftAgentId]
  );

  /* ── Send ── */
  const send = useCallback(
    async (raw?: string) => {
      const text = (raw ?? input).trim();
      if (!text || sending) return;

      // Resolve / create the target conversation up front so we have a stable id.
      let convId = activeId;
      let sessionId: string;
      let agentId: AgentId;

      const existing = conversations.find((c) => c.id === activeId);
      if (existing) {
        convId = existing.id;
        sessionId = existing.sessionId;
        agentId = existing.agentId;
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  title: c.messages.length === 0 ? text.slice(0, 46) : c.title,
                  messages: [...c.messages, { role: 'user', content: text }],
                }
              : c
          )
        );
      } else {
        convId = uid('conv');
        sessionId = uid('sess');
        // Prefer ref so we never send a stale draft agent after a sidebar click.
        agentId = draftAgentIdRef.current;
        const conv: Conversation = {
          id: convId,
          sessionId,
          agentId,
          title: text.slice(0, 46),
          messages: [{ role: 'user', content: text }],
        };
        setConversations((prev) => [conv, ...prev]);
        setActiveId(convId);
      }

      setInput('');
      setSending(true);

      // Add placeholder assistant message.
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId ? { ...c, messages: [...c.messages, { role: 'assistant', content: '' }] } : c
        )
      );

      // History for the harness = prior turns + this user message.
      // Skip client-side connection errors — those never came from the harness,
      // and feeding them back poisons the next turn (and CloudWatch looks "wrong").
      const base = existing ? existing.messages : [];
      const history: ChatMessage[] = [
        ...base.filter((m) => !m.isError),
        { role: 'user', content: text },
      ];

      let assistantText = '';
      const applyAssistant = (content: string, isError = false) => {
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c;
            const updated = [...c.messages];
            updated[updated.length - 1] = { role: 'assistant', content, isError };
            return { ...c, messages: updated };
          })
        );
      };

      await streamChat(
        history,
        sessionId,
        agentId,
        (chunk) => {
          assistantText += chunk;
          applyAssistant(assistantText);
        },
        (errorMsg) => {
          const combined = assistantText
            ? `${assistantText}\n\n⚠️ ${errorMsg}`
            : errorMsg;
          applyAssistant(combined, true);
        },
        () => {},
        (statusMsg) => {
          // Soft progress line while tools run (replaced by real text/errors).
          if (!assistantText) applyAssistant(`_${statusMsg}_`);
        }
      );

      setSending(false);
    },
    [input, sending, activeId, conversations, draftAgentId]
  );

  return {
    // data
    conversations,
    activeConv,
    activeId,
    currentAgentId,
    messages,
    isEmpty,
    agents: AGENTS,
    // ui state
    input,
    setInput,
    sending,
    collapsed,
    toasts,
    // refs
    scrollRef,
    inputRef,
    // actions
    send,
    newChat,
    openConversation,
    selectAgent,
    toggleSidebar,
    wip,
  };
}
