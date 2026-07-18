# Backend (`src/server/`)

**🔒 Do not mix with frontend code. No React, no CSS, no UI imports.**

## What lives here

| File | Purpose |
|---|---|
| `api/chat/route.ts` | **Fallback / local-dev** `POST /api/chat`. Verifies portal JWT (`withAuth`), resolves harness ARN, invokes via IAM `InvokeHarnessCommand`, streams SSE. Production chat prefers browser → AgentCore HTTPS with Cognito JWT (see `src/client/lib/stream.ts` + `agentcore.ts`). |

## How it works

1. **Auth first.** The handler is wrapped in `withAuth` (from `@artelis/auth/server`), which
   verifies the portal Cognito JWT (JWKS + tenant-directory lookup) before any harness call.
   Anonymous callers get 401. In production, agents `general` and `order` may bypass this route
   (browser → AgentCore JWT HTTPS via `NEXT_PUBLIC_HARNESS_ARN*`); other agents always use this
   IAM `/api/chat` path.
2. Receives `POST /api/chat` with `{ messages, sessionId, agentId }`.
3. Resolves the harness ARN for `agentId` (`resolveHarnessArn`) — each agent maps to its own
   `HARNESS_ARN*` env var; a known agent with no ARN configured → 400 (no silent fallback).
4. Picks credentials (`getClient`): ambient compute-role in the same account, or an assumed
   cross-account role when `AGENT_INVOKE_ROLE_ARN` is set.
5. Maps messages to AgentCore content-block shape and calls `InvokeHarnessCommand`.
6. Iterates the async streaming response, emitting SSE events (`data: {...}\n\n`), ending
   with `data: [DONE]\n\n`.
7. The harness uses its own configured system prompt — no override.

## Environment variables

**Harness / model:**

| Var | Required | Default | Purpose |
|---|---|---|---|
| `HARNESS_ARN` | ✅ | — | Harness for the `general` agent (also the fallback) |
| `HARNESS_ARN_ORDER` | for `order` | — | Harness for the `order` agent |
| `HARNESS_REGION` | — | `eu-north-1` | AWS region of the harnesses |
| `BEDROCK_MODEL_ID` | — | `eu.amazon.nova-pro-v1:0` | Model the harness uses |
| `AGENT_INVOKE_ROLE_ARN` | — | (empty = same account) | Cross-account role to assume before invoking |
| `AGENT_INVOKE_EXTERNAL_ID` | — | `agenticcore-prod` | STS ExternalId for the assume-role |

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
