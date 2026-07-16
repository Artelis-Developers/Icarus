# Backend (`src/server/`)

**🔒 Do not mix with frontend code. No React, no CSS, no UI imports.**

## What lives here

| File | Purpose |
|---|---|
| `api/chat/route.ts` | The `POST /api/chat` handler. Verifies the caller's portal JWT (`withAuth`), resolves the harness for the requested agent, invokes it via `InvokeHarnessCommand`, and streams the response back as Server-Sent Events. |

## How it works

1. **Auth first.** The handler is wrapped in `withAuth` (from `@artelis/auth/server`), which
   verifies the portal Cognito JWT (JWKS + tenant-directory lookup) before any harness call.
   Anonymous callers get 401 — this route is the app's trust boundary (no Lambda behind it).
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
| `HARNESS_ARN_REQ_DEV` | for `dev` | — | Harness for the `dev` agent |
| `HARNESS_ARN_ORDER` | for `order` | — | Harness for the `order` agent |
| `HARNESS_ARN_REQ_PRIO` | for `req_prio` | — | Harness for `req_prio` (legacy fallback: `HARNESS_ARN__REQ_PRIO`) |
| `HARNESS_ARN_REQ_PLAN` | for `req_plan` | — | Harness for the `req_plan` agent |
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
