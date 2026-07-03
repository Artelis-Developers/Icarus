# Backend (`src/server/`)

**🔒 Do not mix with frontend code. No React, no CSS, no UI imports.**

## What lives here

| File | Purpose |
|---|---|
| `api/chat/route.ts` | Next.js API route handler. Receives chat messages, invokes the Bedrock AgentCore harness via `InvokeHarnessCommand`, streams the response back as Server-Sent Events. |

## How it works

1. Receives `POST /api/chat` with `{ messages, sessionId }`
2. Maps messages to `HarnessMessage[]` format
3. Calls `InvokeHarnessCommand` with the harness ARN and model ID from env vars
4. Iterates the async streaming response, emitting SSE events (`data: {...}\n\n`)
5. The harness uses its own configured system prompt — no override

## Environment Variables

| Var | Required | Default |
|---|---|---|
| `HARNESS_ARN` | ✅ | — |
| `HARNESS_REGION` | — | `eu-north-1` |
| `BEDROCK_MODEL_ID` | — | `eu.amazon.nova-pro-v1:0` |

## Can I touch it?

Only if you need to change:
- The harness invocation logic
- Streaming/SSE protocol
- Model selection
- Error handling at the API level

**Do NOT add UI code here.**
