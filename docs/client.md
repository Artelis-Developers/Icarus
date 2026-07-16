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
│   ├── stream.ts          → SSE fetch client (attaches the portal bearer via authHeaders)
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
  the same way Requests does: prefer id-token `email`, else portal `GET /auth/me` (cached by
  `PortalUserSync` → `portal-user-profile.ts`), then derive `name` from the email local part
  (`igor.winandy@…` → "Igor Winandy"). Sidebar footer shows that name/email.
- `components/auth-gate.tsx` gates the page via `@artelis/auth`'s `AuthGuard`, with
  loading / access-denied / not-signed-in screens styled in Icarus's own tokens (so no
  `@artelis/theme` dependency).
- `lib/stream.ts` attaches the portal bearer via a 3-tier `resolveAccessToken`
  (`getJWTToken` → `getAccessToken` → `sessionStorage['portal_tokens']`) so the
  `withAuth`-protected `/api/chat` accepts the request. Tier 3 (sessionStorage) is what makes
  it work inside the portal iframe, where the in-memory auth singleton is often unreachable —
  the package's `authHeaders()` helper is singleton-only and 401s there.

## Component rules

1. **Presentational** — state lives in `useChat`, not in components.
2. **`stream.ts` stays free of React** — pure fetch + SSE parser, reusable anywhere.
3. **Use design tokens** from `globals.css` — no hardcoded colors.

## Can I touch it?

- **Yes** for visuals, layout, animations, new components.
- **No** for harness-call changes — that's `src/server/`. The auth context/gate mirror the fleet
  convention; change them in step with `@artelis/auth`, not ad hoc.
