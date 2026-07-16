# `app/` — Next.js Entry Points

**⚠️ These are glue files. Keep logic in `src/`.**

## What each file does

| File | Role |
|---|---|
| `layout.tsx` | Root HTML layout. Imports `globals.css`, wires DM Sans / DM Mono via `next/font`, sets metadata, and wraps children in `<AuthProvider>` (from `src/client/contexts/auth-context`). |
| `page.tsx` | Home page. Renders `<ChatPage />` wrapped in `<AuthGate>` so nothing shows until portal auth resolves. |
| `api/chat/route.ts` | One-liner re-export: `export { POST } from '@/server/api/chat/route'`. |
| `api/auth/validate-origin/route.ts` | Portal origin allowlist handler — `export const { POST } = createValidateOriginHandler()` (from `@artelis/auth/server`). Mandatory for the postMessage handshake; **do not remove.** |

## Why this pattern?

Next.js App Router requires files in `app/`. We keep them as thin wrappers so real code
lives under `src/` with a clean frontend/backend split. The only things that legitimately
live in `app/` are the root layout's provider/metadata/font wiring and the auth route above.

## Can I touch it?

Only if you're:
- Adding a new route/page (put the component in `src/client/`, the logic in `src/server/`).
- Changing root metadata, fonts, or the top-level provider stack.
- Adding a new API endpoint (logic in `src/server/`, thin re-export here).
