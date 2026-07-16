# AgentCore Chat

Chat interface for AWS Bedrock AgentCore Harness. Next.js 16 (React 19) App Router,
embedded as an iframe in the 360 portal and authenticated via `@artelis/auth`.

## Project Structure

```
agentcore-app/
├── app/                          ⚠️ Next.js entry points (thin wrappers)
│   ├── layout.tsx                → fonts + metadata + <AuthProvider>
│   ├── page.tsx                  → <AuthGate><ChatPage/></AuthGate>
│   ├── api/chat/route.ts         → re-exports from src/server
│   └── api/auth/validate-origin/ → portal origin allowlist (@artelis/auth/server)
│
├── src/
│   ├── server/                   🔒 BACKEND — do not mix with UI
│   │   └── api/chat/route.ts     → withAuth + harness SSE streaming endpoint
│   │
│   └── client/                   🎨 FRONTEND — do not touch backend logic
│       ├── components/           → UI building blocks (incl. auth-gate)
│       ├── contexts/             → auth-context (wraps @artelis/auth)
│       ├── hooks/                → React state logic
│       ├── lib/                  → stream (SSE + bearer), agents, storage
│       ├── pages/                → chatpage composition
│       └── styles/               → global tokens + component/shell CSS
│
├── docs/                         📖 Architecture docs (read these!)
├── amplify.yml                   → AWS Amplify build config
├── next.config.js                → CSP frame-ancestors (from ALLOWED_ORIGINS)
└── tsconfig.json                 → TypeScript config (path alias @/ → src/)
```

## Path Alias

All imports use `@/` which maps to `./src/`:

```ts
import { ChatHeader } from '@/client/components/ChatHeader';
```

## Key Rules

1. **`src/server/` is backend.** UI code never imports from here.
2. **`src/client/` is frontend.** No AWS SDK imports in this tree.
3. **`app/` is glue only.** Thin re-exports + root providers/metadata, no domain logic.
4. **Auth is `@artelis/auth`.** `/api/chat` is wrapped in `withAuth`; the client attaches the
   portal bearer. Don't roll custom auth. Icarus keeps its **own** dark/green tokens — it does
   **not** use `@artelis/theme`.

## Setup

```bash
npm install
npm run dev
```

## Environment Variables

Set on the Amplify app (both app-level and branch-level); `amplify.yml` writes them into
`.env.production` at build time. Full reference: [`docs/server.md`](docs/server.md).

**Harness / model** (multi-agent — one ARN per agent):

| Key | Example |
|---|---|
| `HARNESS_ARN` | `arn:aws:bedrock-agentcore:eu-north-1:…:harness/…` (agent `general` + fallback) |
| `HARNESS_ARN_REQ_DEV` / `HARNESS_ARN_ORDER` / `HARNESS_ARN_REQ_PRIO` / `HARNESS_ARN_REQ_PLAN` | per-agent harness ARNs |
| `HARNESS_REGION` | `eu-north-1` (default) |
| `BEDROCK_MODEL_ID` | `eu.amazon.nova-pro-v1:0` (default) |
| `AGENT_INVOKE_ROLE_ARN` / `AGENT_INVOKE_EXTERNAL_ID` | cross-account invoke (optional) |

**Auth** (`@artelis/auth`):

| Key | Example / note |
|---|---|
| `ALLOWED_ORIGINS` | comma-separated portal origins (CSP + validate-origin) |
| `DYNAMODB_USER_POOLS_TABLE` | tenant/pool directory for JWT verification |
| `AWS_REGION` | pool-directory lookup region (usually set by Amplify) |
| `BYPASS_AUTH` | dev only — `false` forces real JWT locally |
