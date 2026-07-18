# Backend (`src/server/`)

**🔒 Do not mix with frontend code. No React, no CSS, no UI imports.**

## What lives here

| File | Purpose |
|---|---|
| `api/chat/route.ts` | `POST /api/chat`. Verifies portal JWT (`withAuth`). `general` / `order` → IAM `InvokeHarnessCommand`. Runtime `InvokeAgentRuntime` path remains in code (parked agents). Production chat for `general` / `order` prefers browser → AgentCore JWT (see `src/client/lib/stream.ts` + `agentcore.ts`). |

## How it works

1. **Auth first.** The handler is wrapped in `withAuth` (from `@artelis/auth/server`), which
   verifies the portal Cognito JWT (JWKS + tenant-directory lookup) before any agent call.
   Anonymous callers get 401. In production, agents `general` and `order` may bypass this route
   (browser → AgentCore JWT HTTPS via `NEXT_PUBLIC_HARNESS_ARN*`).
2. Receives `POST /api/chat` with `{ messages, sessionId, agentId }`.
3. Branches by agent:
   - **Harness** (`general` / `order`): resolves `HARNESS_ARN*` → `InvokeHarnessCommand` with
     message history + model config.
   - **Runtime** (parked: `dev` / `req_plan`): resolves `RUNTIME_ARN_REQ_*` →
     `InvokeAgentRuntimeCommand` with `{ prompt }` + `runtimeUserId` when those agents are re-enabled.
4. Picks credentials (`getClient`): ambient compute-role in the same account, or an assumed
   cross-account role when `AGENT_INVOKE_ROLE_ARN` is set.
5. Buffers the AWS response into SSE events (`data: {...}\n\n`), ending with `data: [DONE]\n\n`.
6. Persona / tools live in the harness or runtime — no system-prompt override in this route.

## Environment variables

**Harness / model:**

| Var | Required | Default | Purpose |
|---|---|---|---|
| `HARNESS_ARN` | ✅ | — | Harness for the `general` agent (also the fallback) |
| `HARNESS_ARN_ORDER` | for `order` | — | Harness for the `order` agent |
| `HARNESS_REGION` | — | `eu-north-1` | AWS region of the harnesses / runtimes |
| `BEDROCK_MODEL_ID` | — | `eu.amazon.nova-pro-v1:0` | Model the harness uses |
| `AGENT_INVOKE_ROLE_ARN` | — | (empty = same account) | Cross-account role to assume before invoking |
| `AGENT_INVOKE_EXTERNAL_ID` | — | `agenticcore-prod` | STS ExternalId for the assume-role |

**Runtime (`InvokeAgentRuntime`):**

| Var | Required | Default | Purpose |
|---|---|---|---|
| `RUNTIME_ARN_REQ_DEV` | parked | — | Runtime ARN for Request Developer (re-enable with agent) |
| `RUNTIME_ARN_REQ_PLAN` | parked | — | Runtime ARN for Request Planner |

**Auth (via `@artelis/auth`):**

| Var | Required | Purpose |
|---|---|---|
| `ALLOWED_ORIGINS` | ✅ (prod) | Comma-separated portal origins; drives both the CSP `frame-ancestors` header and `/api/auth/validate-origin` |
| `DYNAMODB_USER_POOLS_TABLE` | ✅ (prod) | Tenant/pool directory `withAuth` verifies tokens against |
| `AWS_REGION` | — | Region for the pool-directory lookup (usually provided by the Amplify runtime) |
| `BYPASS_AUTH` | — (dev only) | Set `false` to force real JWT locally; no effect in production |

## Can I touch it?

Only to change harness invocation, the streaming/SSE protocol, model selection, agent→harness
routing, or API-level error handling. The `withAuth` wrapper must stay. **Do NOT add UI code here.**
