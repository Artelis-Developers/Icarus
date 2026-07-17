# Frontend (`src/client/`)

**🎨 UI code only. No AWS SDK imports. No server-side logic.**

## Structure

```
src/client/
├── components/            → presentational UI (lowercase filenames, PascalCase exports)
│   ├── sidebar, topbar, composer, chatinput, chatheader
│   ├── messagebubble, codeblock, emptystate, typingindicator
│   ├── agenticon, wiptoast
│   ├── auth-gate.tsx        → portal auth gate (wraps @artelis/auth AuthGuard)
│   └── portal-user-sync.tsx → refreshes portal `/auth/me` into sessionStorage
├── contexts/
│   └── auth-context.tsx   → wraps @artelis/auth; enriches useAuth with id-token / `/auth/me` email
├── hooks/
│   └── usechat.ts         → conversation state + streaming orchestration
├── lib/
│   ├── stream.ts          → chat invoke: AgentCore JWT HTTPS (prod) or /api/chat fallback
│   ├── agentcore.ts       → runtime ARN map, invocation URL, session id length
│   ├── agents.ts          → agent roster + starter suggestions
│   ├── storage.ts         → iframe-safe localStorage (in-memory fallback)
│   ├── portal-user-profile.ts → fetch/cache portal `GET /auth/me` (real email for SSO)
│   └── display-identity.ts    → id-token email decode + name-from-email helpers
├── pages/
│   └── chatpage.tsx       → main page composition (consumes useChat)
└── styles/
    ├── globals.css        → design tokens (CSS custom properties) + resets
    └── *.module.css       → per-component + shell styles (incl. auth-gate.module.css)
```

## Design system

Dark-only. All colors/spacing/fonts are CSS custom properties in `globals.css`; components use
CSS Modules. Icarus keeps its **own** token set (green accent) — it does **not** use
`@artelis/theme` (the fleet's shared palette). Keep it that way unless a deliberate rebrand is decided.

### Key tokens (see `globals.css` for the full list)
| Token | Usage |
|---|---|
| `--bg`, `--bg-sidebar`, `--bg-elevated` | Surfaces (app, sidebar, raised) |
| `--surface`, `--surface-alt` | Panels, message bubbles |
| `--accent` (`#00d68f`), `--accent-ink` | Primary green + its ink; `--agent` overrides it per subtree |
| `--text`, `--text-secondary`, `--text-muted` | Text scale |
| `--border`, `--border-strong` | Dividers |
| `--danger` | Errors |
| `--font-sans`, `--font-mono` | DM Sans / DM Mono (wired via `next/font` in `app/layout.tsx`) |

## Auth (added in the shared-stack migration)

- `contexts/auth-context.tsx` wraps `@artelis/auth`'s `AuthProvider`, mounted in `app/layout.tsx`.
  Standalone dev (not in an iframe) bypasses to a demo identity; the portal iframe runs the
  postMessage handshake.
- Cognito **access** tokens often omit email for SSO users. Icarus enriches `useAuth().user`
  from: (1) portal `ms-auth` postMessage email (session — preferred; cookies are SameSite=Lax so
  cross-origin `/auth/me` usually cannot run), (2) id-token `email`, (3) cached `/auth/me` when
  same-site. Display `name` is derived **only** from that email local part
  (`igor.winandy@…` → "Igor Winandy"). Cognito/portal `name` claims are ignored.
- `components/auth-gate.tsx` gates the page via `@artelis/auth`'s `AuthGuard`, with
  loading / access-denied / not-signed-in screens styled in Icarus's own tokens (so no
  `@artelis/theme` dependency).
- `lib/stream.ts` attaches the portal Cognito access token via a 3-tier `resolveAccessToken`
  (`getJWTToken` → `getAccessToken` → `sessionStorage['portal_tokens']`). For agents
  `general` and `order` only, when `NEXT_PUBLIC_HARNESS_ARN` / `NEXT_PUBLIC_HARNESS_ARN_ORDER`
  are set, it POSTs to AgentCore `/runtimes/{arn}/invocations` with Bearer + session header
  (`lib/agentcore.ts`). All other agents keep Amplify `/api/chat`. Tier 3 (sessionStorage) is
  what makes the token available inside the portal iframe.

## Component rules

1. **Presentational** — state lives in `useChat`, not in components.
2. **`stream.ts` stays free of React** — pure fetch + SSE parser, reusable anywhere.
3. **Use design tokens** from `globals.css` — no hardcoded colors.

## Can I touch it?

- **Yes** for visuals, layout, animations, new components, and the browser AgentCore JWT invoke path (`stream.ts` / `agentcore.ts`).
- **Server `/api/chat`** remains the IAM fallback — change harness invoke there carefully; keep `withAuth`.
- Auth context/gate mirror the fleet convention; change them in step with `@artelis/auth`, not ad hoc.
