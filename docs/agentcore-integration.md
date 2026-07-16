# AgentCore Harness Integration Guide

> **Audience:** an AI (or engineer) that needs to understand this application and
> reproduce or extend its chatbot on top of **AWS Bedrock AgentCore**.
> Read this end-to-end before writing code. Every file path is relative to the repo root.

---

## 1. What this application is

**Ikairus** (package name `agentcore-chat`) is a streaming web chatbot for a corporate
group (Artelis · VSE NET · Cegecom). It is a **Next.js 16 App Router** app (React 19),
embedded as an **iframe inside the 360 portal**, that:

- Presents a multi-agent chat UI (a sidebar roster of assistants + a chat thread).
- Sends each user turn to a **server-side API route**.
- That route invokes an **AWS Bedrock AgentCore Harness**, which runs the agent logic
  and calls a Bedrock foundation model.
- Streams tokens back to the browser as **Server-Sent Events (SSE)** so text appears live.

The central idea: **the browser never talks to AWS.** A Next.js server route is the
secure bridge. It holds AWS credentials (via an IAM role) and translates between the
app's JSON/SSE protocol and the AgentCore `InvokeHarness` streaming API.

Access is gated by **portal auth** (`@artelis/auth`): the `/api/chat` route is wrapped in
`withAuth`, which verifies the caller's Cognito JWT before any harness call, and the client
attaches the portal bearer token to each request. See §2.1.

> A "harness" here = a Bedrock AgentCore **agent runtime**. It is the deployed AI agent.
> The app connects to a specific harness by its **ARN**.

---

## 2. Architecture & data flow

```
Browser (React, src/client)
   │  fetch POST /api/chat  { messages: [{role, content}], sessionId, agentId }
   │  + Authorization: Bearer <portal Cognito token>   (attached by authHeaders())
   ▼
Next.js SSR route (src/server/api/chat/route.ts)   ← runs on Amplify compute w/ IAM role
   │  withAuth verifies the JWT (JWKS + tenant directory) → 401 if invalid/missing
   │  BedrockAgentCoreClient.send(InvokeHarnessCommand{ harnessArn, runtimeSessionId, messages, model })
   ▼
Bedrock AgentCore Harness ──► Bedrock foundation model
   │  async event stream (contentBlockDelta / messageStop / metadata)
   ▼  re-emitted as SSE lines: data: {"type":"text","text":"..."}\n\n
Browser (src/client/lib/stream.ts parses SSE, appends tokens to the active message)
```

### Layering rules (enforced by directory structure)

| Layer | Path | Rule |
|---|---|---|
| Entry glue | `app/` | Thin re-exports + root providers/metadata. No domain logic. |
| Backend | `src/server/` | AWS SDK lives here. **No React/UI imports.** |
| Frontend | `src/client/` | UI + state only. **No AWS SDK imports.** |
| Auth | `@artelis/auth` | Portal token handshake (client) + `withAuth` JWT verify (server). The app never rolls its own auth. |

`app/api/chat/route.ts` is literally one line: `export { POST } from '@/server/api/chat/route';`
The `@/` path alias maps to `./src/` (resolved natively via `tsconfig.json` paths — Next 16 uses
Turbopack, so there is no bundler alias in `next.config.js`).

### 2.1 Authentication (portal iframe)

Auth is provided by `@artelis/auth`, wired the same way across the 360 fleet:

- **Client:** `src/client/contexts/auth-context.tsx` wraps `AuthProvider` (mounted in
  `app/layout.tsx`); `src/client/components/auth-gate.tsx` gates the page with `AuthGuard`.
  In an iframe it runs the `ms-ready`/`ms-auth` postMessage handshake with the portal; in
  standalone dev it bypasses to a demo identity.
- **Origin gate (two halves, one env var `ALLOWED_ORIGINS`):** the CSP `frame-ancestors`
  header (`next.config.js`, browser-enforced, fail-closed) and `POST /api/auth/validate-origin`
  (`createValidateOriginHandler()`, app-enforced). Origins are never hardcoded.
- **Server:** `/api/chat`'s handler is wrapped in `withAuth` from `@artelis/auth/server`,
  which verifies the Cognito JWT against the issuing pool's JWKS (pool looked up in
  `DYNAMODB_USER_POOLS_TABLE`). This is the app's only trust boundary — there is no Lambda behind it.
- **Token attach:** `src/client/lib/stream.ts` sends `Authorization: Bearer <token>`, resolving
  the token via a 3-tier `resolveAccessToken` (`getJWTToken` → `getAccessToken` →
  `sessionStorage['portal_tokens']`). The sessionStorage tier is required inside the iframe,
  where the in-memory auth singleton is often unreachable (the package's `authHeaders()` is
  singleton-only and would 401 there).

---

## 3. The harness integration (the part that matters)

All harness logic is in **`src/server/api/chat/route.ts`**. This is the file to study and
copy when integrating a new chatbot.

### 3.1 Dependency

```json
"@aws-sdk/client-bedrock-agentcore": "^3.1079.0"
```

### 3.2 Client creation — credentials are implicit

```ts
new BedrockAgentCoreClient({ region: REGION });
```

No access keys are passed. On AWS Amplify the SDK picks up credentials from the attached
**compute IAM role**. Locally it uses your default AWS credential chain (`~/.aws`, env vars).
**Never hardcode credentials or expose them to the client bundle.**

### 3.3 Request contract (browser → route)

`POST /api/chat` with an `Authorization: Bearer <portal token>` header (the client resolves and
attaches it — see §2.1; `withAuth` rejects the request otherwise) and JSON body:

```jsonc
{
  "messages": [ { "role": "user" | "assistant", "content": "string" }, ... ],
  "sessionId": "string",  // stable per conversation = AgentCore runtimeSessionId
  "agentId": "string"     // which agent → which harness (see §4); defaults to "general"
}
```

The route validates that `messages` is an array, resolves the harness for `agentId`, maps each
message to AgentCore's content-block shape, and generates a `sessionId` if one is missing:

```ts
const harnessMessages = messages.map((m) => ({
  role: (m.role === 'assistant' ? 'assistant' : 'user'),
  content: [{ text: m.content }],   // AgentCore wants content BLOCKS, not a bare string
}));
const sid = sessionId || crypto.randomUUID();
```

### 3.4 Invoke the harness

```ts
const command = new InvokeHarnessCommand({
  harnessArn: HARNESS_ARN,          // which agent to talk to (from env)
  runtimeSessionId: sid,            // keeps multi-turn continuity server-side
  messages: harnessMessages,
  model: { bedrockModelConfig: { modelId: MODEL_ID } },
});
const response = await client.send(command);   // response.stream is an async iterable
```

### 3.5 Response streaming (route → browser)

Iterate `response.stream` and re-emit each event as an SSE `data:` line. Three event types
are handled; everything ends with a `[DONE]` sentinel:

```ts
for await (const event of response.stream) {
  if (event.contentBlockDelta?.delta?.text) {
    emit({ type: 'text', text: event.contentBlockDelta.delta.text });
  } else if (event.messageStop) {
    emit({ type: 'stop', reason: event.messageStop.stopReason });
  } else if (event.metadata) {
    emit({ type: 'metadata', usage: event.metadata.usage });
  }
}
// on error: emit({ type: 'error', message }) ; finally: write "data: [DONE]\n\n"
```

Response headers must be:
`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.

Route runtime config (required for streaming on Amplify):

```ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
```

### 3.6 SSE wire format (the contract the client parses)

Each event is one line: `data: <json>\n\n`. Stream terminates with `data: [DONE]\n\n`.
Client parser: `src/client/lib/stream.ts` (framework-agnostic, zero React imports).
Event JSON shape: `{ type: 'text'|'stop'|'metadata'|'error', text?, reason?, usage?, message? }`.

---

## 4. Configuration (environment variables)

The app is **multi-agent**: each UI agent maps to its own harness ARN env var
(`HARNESS_ENV_BY_AGENT` in `src/server/api/chat/route.ts`). Auth adds a second group of vars
(`@artelis/auth`). All are written into `.env.production` by `amplify.yml` at build time.

**Harness / model:**

| Var | Required | Default | Purpose |
|---|---|---|---|
| `HARNESS_ARN` | ✅ | — | Harness for the `general` agent (also the fallback) |
| `HARNESS_ARN_REQ_DEV` | for `dev` | — | Harness for the `dev` agent |
| `HARNESS_ARN_ORDER` | for `order` | — | Harness for the `order` agent |
| `HARNESS_ARN_REQ_PRIO` | for `req_prio` | — | Harness for `req_prio` (legacy fallback key: `HARNESS_ARN__REQ_PRIO`) |
| `HARNESS_ARN_REQ_PLAN` | for `req_plan` | — | Harness for the `req_plan` agent |
| `HARNESS_REGION` | — | `eu-north-1` | AWS region of the harnesses |
| `BEDROCK_MODEL_ID` | — | `eu.amazon.nova-pro-v1:0` | Model the harness uses |
| `AGENT_INVOKE_ROLE_ARN` | — | (empty = same account) | Cross-account role to assume before invoking |
| `AGENT_INVOKE_EXTERNAL_ID` | — | `agenticcore-prod` | STS ExternalId for the assume-role |

**Auth (`@artelis/auth`):**

| Var | Required | Purpose |
|---|---|---|
| `ALLOWED_ORIGINS` | ✅ (prod) | Comma-separated portal origins; drives the CSP `frame-ancestors` header **and** `/api/auth/validate-origin` |
| `DYNAMODB_USER_POOLS_TABLE` | ✅ (prod) | Tenant/pool directory `withAuth` verifies tokens against |
| `AWS_REGION` | — | Region for the pool-directory lookup (usually set by the Amplify runtime) |
| `BYPASS_AUTH` | — (dev only) | Set `false` to force real JWT locally; no effect in production |

A known agent with no ARN configured returns **400** (no silent fallback to `general`).
Local dev: put values in `.env.local` (git-ignored). Production: `amplify.yml` writes them
into `.env.production` from the Amplify app/branch environment.

> **ARN gotcha:** the harness ARN suffix differs from the runtime ID suffix. Get the real
> ARN from the Bedrock console harness detail page or the CloudTrail `CreateAgentRuntime`
> event (`X-Amzn-Bedrock-AgentCore-Source-Arn`). Passing the runtime ID will fail.

---

## 5. Required AWS resources

| # | Resource | Why | Defined in |
|---|---|---|---|
| 1 | Bedrock **model access** enabled | Harness can't call a locked model | Console (manual) |
| 2 | An AgentCore **harness** (status `READY`) | This *is* the AI agent; gives `HARNESS_ARN` | `create_agent_runtime` (boto3) |
| 3 | IAM **compute role** | Lets Amplify's route call the harness + model | `infra/template.yaml` (CloudFormation) |
| 4 | **Amplify app** (`WEB_COMPUTE` + `Next.js - SSR`) | Hosts the SSR route, attaches the role & env vars | AWS CLI / Console |

The IAM role must allow (see `infra/template.yaml`):
- `bedrock-agentcore:InvokeHarness` (+ `InvokeAgentRuntime`, `InvokeAgentRuntimeForUser`)
  on `harness/*` and `runtime/*`
- `bedrock:InvokeModel` / `bedrock:InvokeModelWithResponseStream` on the foundation model +
  inference profiles

Full step-by-step provisioning: `deploy.md`. One-shot automation: `infra/bootstrap.sh`.

---

## 6. Frontend touch points (only if the new chatbot changes the UI)

- `src/client/hooks/usechat.ts` — owns conversation state. Each `Conversation` carries a
  stable `sessionId` (the AgentCore `runtimeSessionId`) so turns are correlated server-side.
  `send()` optimistically adds the user message + an empty assistant placeholder, then calls
  `streamChat()` and appends streamed chunks.
- `src/client/lib/stream.ts` — SSE fetch client. Reusable as-is.
- `src/client/lib/agents.ts` — the agent roster (`AGENTS`) and starter suggestions. Five
  agents ship, **all `wired: true`**: `general`, `dev`, `order`, `req_prio`, `req_plan`.
  `normalizeAgentId` maps legacy ids (`hr` → `order`, `board` → `req_prio`). An agent with
  `wired: false` shows a "coming soon" toast and does not call the backend.

---

## 7. How to integrate a NEW chatbot based on this app

Pick the scenario that matches your goal.

### Scenario A — Stand up a brand-new chatbot (new deployment, one agent)

1. **Create a harness** for your agent in a supported region
   (`eu-north-1`, `us-east-1`, `us-west-2`). Enable its model in Bedrock model access.
   Note the harness **ARN**.
2. **Reuse `src/server/api/chat/route.ts` unchanged.** Its contract is generic — the agent's
   behavior/persona lives inside the harness, not in this code.
3. **Set env vars** `HARNESS_ARN`, `HARNESS_REGION`, `BEDROCK_MODEL_ID` (`.env.local` for
   dev; Amplify app+branch for prod).
4. **Provision AWS**: deploy `infra/template.yaml` for the IAM role, create the Amplify app
   (`WEB_COMPUTE`, framework `Next.js - SSR`), attach the compute role, set env vars.
5. **Rebrand the UI** if desired: metadata in `app/layout.tsx`, roster/suggestions in
   `src/client/lib/agents.ts`, tokens in `src/client/styles/globals.css`.
6. **Verify** (see §8).

> The only thing that makes it a "different chatbot" is a different `HARNESS_ARN`
> (and optionally `BEDROCK_MODEL_ID`). No route code changes are required.

### Scenario B — Add another agent to this app, backed by its own harness

Multi-agent routing already exists: the client sends `agentId`, and the route maps it to a
harness via `HARNESS_ENV_BY_AGENT` (`src/server/api/chat/route.ts`). To add a new agent:

1. **Add it to the roster** in `src/client/lib/agents.ts` (`AGENTS`, with `wired: true` and an
   accent color); add starter `SUGGESTIONS` if desired.
2. **Add its env mapping** in `HARNESS_ENV_BY_AGENT` — `<newAgentId>: 'HARNESS_ARN_<NEW>'` — so
   `resolveHarnessArn()` finds its ARN. (Client `stream.ts` / `useChat` already forward `agentId`.)
3. **Grant IAM** access to the new harness ARN (the `harness/*` wildcard in
   `infra/template.yaml` already covers same-account harnesses).
4. Set the new `HARNESS_ARN_<NEW>` env var on Amplify (app + branch) and redeploy.

### Minimal contract an integrator must honor

- Request body: `{ messages: {role,content}[], sessionId }`.
- AgentCore message shape: `content` is an array of blocks `[{ text }]`, **not** a string.
- Keep `sessionId` stable per conversation for multi-turn memory.
- Stream SSE `data: {json}\n\n` lines and always terminate with `data: [DONE]\n\n`.
- Emit errors as `{ type: 'error', message }` rather than throwing across the stream.

---

## 8. Verify the integration

`/api/chat` is now **auth-protected** (`withAuth`). In local dev the auth bypass is active, so
a token-less request works and the curl below succeeds. In production it will **401 without a
valid `Authorization: Bearer <portal token>`** — that is the intended hardening; drive it from
inside the portal iframe (where the client attaches the token) rather than curl.

```bash
# Local (dev bypass active)
npm install && npm run dev
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}],"sessionId":"test-1234","agentId":"general"}'
```

Expect an SSE stream of `data: {"type":"text","text":"..."}` lines ending in `data: [DONE]`.

---

## 9. Known gotchas

| Symptom | Cause / Fix |
|---|---|
| Amplify 404 on pages/API | Platform must be `WEB_COMPUTE`, not `WEB` (static can't do SSR routes). |
| Framework not detected | Set framework explicitly to `Next.js - SSR`. |
| Env vars missing at runtime | Set at **both** app-level and branch-level; they're also inlined in `next.config.js`. |
| `InvokeHarness` fails / not found | Wrong ARN — use the **harness ARN**, not the runtime ID. |
| No Python on Amplify | Amplify compute is Node-only. Use `@aws-sdk/client-bedrock-agentcore`, not boto3, in app code. |
| Model access denied | Enable the model in Bedrock → Model access (Anthropic models need a use-case form). |
| Stray `<thinking>` tags in output | Some models stream thinking tags; filter client-side if undesired. |

---

## 10. File map (for quick navigation)

```
app/layout.tsx                       root layout; fonts + <AuthProvider>
app/page.tsx                         home; <AuthGate><ChatPage/></AuthGate>
app/api/chat/route.ts                re-export → src/server/api/chat/route.ts
app/api/auth/validate-origin/route.ts  portal origin allowlist (@artelis/auth/server)
src/server/api/chat/route.ts         🔒 withAuth + harness invocation + SSE streaming (COPY THIS)
src/client/contexts/auth-context.tsx  @artelis/auth AuthProvider wrapper (+ dev bypass)
src/client/components/auth-gate.tsx   @artelis/auth AuthGuard, Icarus-styled screens
src/client/lib/stream.ts             SSE parser + bearer attach (authHeaders)
src/client/hooks/usechat.ts          conversation state, sessionId, streaming orchestration
src/client/lib/agents.ts             agent roster + wired flags (5 agents)
next.config.js                       CSP frame-ancestors from ALLOWED_ORIGINS (no bundler alias)
infra/template.yaml                  IAM compute role (CloudFormation)
infra/bootstrap.sh                   one-shot provisioning
deploy.md                            full manual deployment walkthrough
```
