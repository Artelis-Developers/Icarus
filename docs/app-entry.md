# `app/` — Next.js Entry Points

**⚠️ These are glue files. Do not add logic here.**

## What each file does

| File | Role |
|---|---|
| `layout.tsx` | Root HTML layout. Imports `globals.css`, sets metadata. Nothing else. |
| `page.tsx` | Home page. Renders `<ChatPage />` from `src/client/pages/`. |
| `api/chat/route.ts` | One-liner re-export: `export { POST } from '@/server/api/chat/route'`. |

## Why this pattern?

Next.js App Router requires files in `app/`. We keep them as thin wrappers so:

1. All real code lives under `src/` with clean separation
2. `app/` never needs to change when refactoring
3. The boundary between frontend and backend is enforced by the directory structure

## Can I touch it?

Only if you're:
- Adding a new route/page (and even then, put the component in `src/client/`)
- Changing root metadata or fonts
- Adding a new API endpoint (put the logic in `src/server/`, re-export here)
