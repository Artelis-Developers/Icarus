# Frontend (`src/client/`)

**🎨 UI code only. No AWS SDK imports. No server-side logic.**

## Structure

```
src/client/
├── components/
│   ├── ChatHeader.tsx          → Top bar (logo, title, status)
│   ├── ChatInput.tsx           → Textarea + send button
│   ├── MessageBubble.tsx       → Single message render (user/assistant/error)
│   ├── TypingIndicator.tsx     → Animated dots while waiting
│   └── EmptyState.tsx          → Welcome screen before first message
│
├── hooks/
│   └── useChat.ts              → Message state + streaming orchestration
│
├── lib/
│   └── stream.ts               → SSE fetch client (framework-agnostic)
│
└── styles/
    ├── globals.css             → Design tokens (CSS custom properties)
    └── ChatApp.module.css      → App shell layout
```

## Design System

All colors, spacing, and fonts are defined as CSS custom properties in `globals.css`. Components use CSS Modules — no global selectors beyond tokens.

### Key tokens
| Token | Usage |
|---|---|
| `--bg` | App background |
| `--surface` | Header / input bar |
| `--surface-2` | Message bubbles (assistant) |
| `--accent` | Send button, focus rings, user bubble gradient start |
| `--accent-2` | User bubble gradient end |
| `--text` | Primary text |
| `--text-dim` | Hints, subtitles |
| `--border` | Subtle dividers |

## Component Rules

1. **Each component is self-contained** — its own `.tsx` + `.module.css`
2. **Components are presentational** — state lives in `useChat` hook
3. **`stream.ts` has zero React imports** — pure fetch + SSE parser, reusable anywhere

## Can I touch it?

- **Yes** if you're changing visuals, layout, animations, adding components
- **No** if you need to change how the harness is called — that's `src/server/`

## Adding a new component

1. Create `ComponentName.tsx` + `ComponentName.module.css` in `components/`
2. Import into `ChatPage.tsx` or wherever needed
3. Use design tokens from `globals.css` — no hardcoded colors
