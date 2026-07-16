# AgentCore Harness Integration Guide

> **Audience:** an AI (or engineer) that needs to understand this application and
> reproduce or extend its chatbot on top of **AWS Bedrock AgentCore**.
> Read this end-to-end before writing code. Every file path is relative to the repo root.

---

## 1. What this application is

**Ikairus** (package name `agentcore-chat`) is a streaming web chatbot for a corporate
group (Artelis · VSE NET · Cegecom). It is a **Next.js 14 App Router** app that:

- Presents a multi-agent chat UI (a sidebar roster of assistants + a chat thread).
- Sends each user turn to a **server-side API route**.
- That route invokes an **AWS Bedrock AgentCore Harness**, which runs the agent logic
  and calls a Bedrock foundation model.
- Streams tokens back to the browser as **Server-Sent Events (SSE)** so text appears live.

The central idea: **the browser never talks to AWS.** A Next.js server route is the
secure bridge. It holds AWS credentials (via an IAM role) and translates between the
app's JSON/SSE protocol and the AgentCore `InvokeHarness` streaming API.

> A "harness" here = a Bedrock AgentCore **agent runtime**. It is the deployed AI agent.
> The app connects to a specific harness by its **ARN**.

---

## 2. Architecture & data flow

```
Browser (React, src/client)
   │  fetch POST /api/chat  { messages: [{role, content}], sessionId }
   ▼
Next.js SSR route (src/server/api/chat/route.ts)   ← runs on Amplify compute w/ IAM role
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
| Entry glue | `app/` | Thin re-exports only. No logic. |
| Backend | `src/server/` | AWS SDK lives here. **No React/UI imports.** |
| Frontend | `src/client/` | UI + state only. **No AWS SDK imports.** |

`app/api/chat/route.ts` is literally one line: `export { POST } from '@/server/api/chat/route';`
The `@/` path alias maps to `./src/` (see `tsconfig.json` and `next.config.js`).

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

`POST /api/chat` with JSON body:

```jsonc
{
  "messages": [ { "role": "user" | "assistant", "content": "string" }, ... ],
  "sessionId": "string"   // stable per conversation = AgentCore runtimeSessionId
}
```

The route validates that `messages` is an array, maps each message to AgentCore's
content-block shape, and generates a `sessionId` if one is missing:

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

The route reads exactly three env vars (`src/server/api/chat/route.ts`), also inlined in
`next.config.js` because Amplify SSR does not reliably pass env vars to the runtime:

| Var | Required | Purpose | Example |
|---|---|---|---|
| `HARNESS_ARN` | ✅ | The specific AgentCore harness to invoke | `arn:aws:bedrock-agentcore:eu-north-1:<acct>:harness/harness_cegecom_general-XXXX` |
| `HARNESS_REGION` | — (default `eu-north-1`) | AWS region of the harness | `eu-north-1` |
| `BEDROCK_MODEL_ID` | — (default `eu.amazon.nova-pro-v1:0`) | Model the harness uses | `zai.glm-5`, `eu.amazon.nova-pro-v1:0` |

Local dev: put these in `.env.local` (git-ignored). Production: set on the Amplify app at
**both app-level and branch-level**.

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
- `src/client/lib/agents.ts` — the agent roster (`AGENTS`) and starter suggestions. Each
  agent has a `wired: boolean`. **Only `general` is `wired: true`;** selecting an unwired
  agent shows a "coming soon" toast and does not call the backend.

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

### Scenario B — Add a second agent to this app, backed by its own harness

Today the route ignores agent identity and always uses one `HARNESS_ARN`. To route
different agents to different harnesses:

1. **Send the agent id** from the client. In `src/client/lib/stream.ts`, add `agentId` to the
   POST body; pass `currentAgentId` through `useChat.send()`.
2. **Map id → ARN** in the route. Replace the single `HARNESS_ARN` with a lookup, e.g. env
   vars `HARNESS_ARN_GENERAL`, `HARNESS_ARN_DEV`, … and select by incoming `agentId`
   (fall back to the general harness).
3. **Flip `wired: true`** for the new agent in `src/client/lib/agents.ts` so the UI actually
   calls the backend instead of showing the WIP toast.
4. **Grant IAM** access to the new harness ARN (the `harness/*` wildcard in
   `infra/template.yaml` already covers same-account harnesses).
5. Set the new env var(s) on Amplify (app + branch) and redeploy.

### Minimal contract an integrator must honor

- Request body: `{ messages: {role,content}[], sessionId }`.
- AgentCore message shape: `content` is an array of blocks `[{ text }]`, **not** a string.
- Keep `sessionId` stable per conversation for multi-turn memory.
- Stream SSE `data: {json}\n\n` lines and always terminate with `data: [DONE]\n\n`.
- Emit errors as `{ type: 'error', message }` rather than throwing across the stream.

---

## 8. Verify the integration

```bash
# Local
npm install && npm run dev
# then POST to the running dev server, or in prod:
curl -X POST https://<host>/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}],"sessionId":"test-1234"}'
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
app/api/chat/route.ts          re-export → src/server/api/chat/route.ts
src/server/api/chat/route.ts   🔒 harness invocation + SSE streaming (COPY THIS)
src/client/lib/stream.ts       SSE parser (client contract)
src/client/hooks/usechat.ts    conversation state, sessionId, streaming orchestration
src/client/lib/agents.ts       agent roster + wired flags
next.config.js                 env inlining + @/ alias
infra/template.yaml            IAM compute role (CloudFormation)
infra/bootstrap.sh             one-shot provisioning
deploy.md                      full manual deployment walkthrough
```
