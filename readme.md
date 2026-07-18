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
4. **Auth is `@artelis/auth`.** The portal Cognito access token is attached as
   `Authorization: Bearer` for chat. For `general` / `order` (when `NEXT_PUBLIC_HARNESS_ARN*`
   is set), the browser calls AgentCore HTTPS directly; other agents use `/api/chat`. Icarus keeps
   its **own** dark/green tokens — it does **not** use `@artelis/theme`.

## Setup

```bash
npm install
npm run dev
```

## Environment Variables

Set on the Amplify app (both app-level and branch-level); `amplify.yml` writes them into
`.env.production` at build time. Full reference: [`docs/server.md`](docs/server.md).

**AgentCore JWT invoke (only `general` + `order`):**

| Key | Example |
|---|---|
| `NEXT_PUBLIC_AGENTCORE_REGION` | `eu-north-1` |
| `NEXT_PUBLIC_AGENTCORE_QUALIFIER` | `DEFAULT` |
| `NEXT_PUBLIC_HARNESS_ARN` | JWT-enabled **runtime** ARN for General Assistant |
| `NEXT_PUBLIC_HARNESS_ARN_ORDER` | JWT-enabled **runtime** ARN for Order Agent |

Other agents always use `/api/chat`. Until the two `NEXT_PUBLIC_HARNESS_ARN*` vars are set,
`general` / `order` also fall back to `/api/chat`.

**Harness / model** (Amplify SSR `/api/chat` — IAM; fallback for `general` / `order` when JWT unset):

| Key | Example |
|---|---|
| `HARNESS_ARN` | `arn:aws:bedrock-agentcore:eu-north-1:…:harness/…` (agent `general` + fallback) |
| `HARNESS_ARN_ORDER` | harness ARN for the `order` agent |

**Runtime** (Amplify SSR `/api/chat` — IAM `InvokeAgentRuntime` for `dev` / `req_prio` / `req_plan`):

| Key | Example |
|---|---|
| `RUNTIME_ARN_REQ_DEV` / `RUNTIME_ARN_REQ_PRIO` / `RUNTIME_ARN_REQ_PLAN` | `arn:aws:bedrock-agentcore:eu-north-1:…:runtime/…` (optional `/runtime-endpoint/DEFAULT` suffix is stripped → qualifier) |
| `HARNESS_REGION` | `eu-north-1` (default) |
| `BEDROCK_MODEL_ID` | `eu.amazon.nova-pro-v1:0` (default; harness path only) |
| `AGENT_INVOKE_ROLE_ARN` / `AGENT_INVOKE_EXTERNAL_ID` | cross-account invoke (optional) |

**Auth** (`@artelis/auth`):

| Key | Example / note |
|---|---|
| `ALLOWED_ORIGINS` | comma-separated portal origins (CSP + validate-origin) |
| `DYNAMODB_USER_POOLS_TABLE` | tenant/pool directory for JWT verification |
| `AWS_REGION` | pool-directory lookup region (usually set by Amplify) |
| `BYPASS_AUTH` | dev only — `false` forces real JWT locally |
