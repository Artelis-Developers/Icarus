# Handoff: Amplify SSR timeout vs long-running AgentCore agents

**App:** Icarus (Next.js on Amplify Hosting SSR)  
**Region (agents):** `eu-north-1`  
**Account (AgentCore / invoke role):** `145928770924`  
**Date context:** Jul 2026

---

## 1. Exact problem

Amplify Hosting SSR compute **hard-kills** Next.js route handlers around **~30 seconds**.  
Icarus soft-aborts at **25s** (`AMPLIFY_SOFT_TIMEOUT_MS` in `src/server/api/chat/route.ts`).

**Request Developer** and **Request Planner** are long-running AgentCore **runtimes** (private git skills, tools). They often need **more than 30s**.

When the UI calls them through Amplify:

```
Browser → POST /api/chat → assume AgentCoreInvokeRole → InvokeAgentRuntime → wait for full reply → SSE
```

Amplify dies while still waiting → chat times out / streaming fails.  
This is an **Amplify platform limit**, not a bug in AgentCore itself and not fixed by “just saving to DynamoDB” while the same SSR request is still waiting.

---

## 2. Two invoke paths in this app (do not mix them up)

| Agents | UI today | Call path | AWS API | Auth to AgentCore |
|---|---|---|---|---|
| `general`, `order` | **Live** in sidebar | Browser → AgentCore HTTPS (preferred) | **InvokeHarness** | Cognito **JWT Bearer** on harness |
| `dev`, `req_plan` | **Parked** (commented out of roster) | Was: Browser → Amplify `/api/chat` | **InvokeAgentRuntime** | **IAM SigV4** (+ `runtimeUserId`) |

### Path A — General / Order (browser JWT, avoids Amplify timeout)

**Code:** `src/client/lib/agentcore.ts`, `src/client/lib/stream.ts`  
**When:** `NEXT_PUBLIC_HARNESS_ARN` / `NEXT_PUBLIC_HARNESS_ARN_ORDER` set  

```
POST https://bedrock-agentcore.{region}.amazonaws.com/harnesses/invoke?harnessArn=…
Authorization: Bearer <portal Cognito access token>
X-Amzn-Bedrock-AgentCore-Runtime-Session-Id: <session ≥ 33 chars>
Body: { messages: [{ role: "user", content: [{ text: "…" }] }] }   // last user turn only
```

- ARN type: `arn:aws:bedrock-agentcore:…:harness/…` (not `runtime/…`)
- Fallback if public ARNs missing: same agents via `/api/chat` + IAM `InvokeHarnessCommand`

### Path B — Developer / Planner (Amplify IAM, hits SSR timeout)

**Code:** `src/server/api/chat/route.ts` (`InvokeAgentRuntimeCommand`)  
**Client:** always `POST /api/chat` for non-JWT agents (`stream.ts` → `streamViaApiChat`)

```
POST /api/chat
Authorization: Bearer <portal Cognito access token>   // verified by withAuth (@artelis/auth)
Body: { messages, sessionId, agentId: "dev" | "req_plan" }

Server:
  STS AssumeRole → AgentCoreInvokeRole (if AGENT_INVOKE_ROLE_ARN set)
  InvokeAgentRuntimeCommand {
    agentRuntimeArn,          // …:runtime/…  (strip /runtime-endpoint/DEFAULT → qualifier)
    qualifier,                // e.g. DEFAULT
    runtimeSessionId,
    runtimeUserId,            // Cognito sub from withAuth user.id — NOT from client body
    contentType: "application/json",
    accept: "text/event-stream, application/json",
    payload: Uint8Array(JSON.stringify({ prompt }))
  }
```

- ARN type: `arn:aws:bedrock-agentcore:…:runtime/…`  
  Console copies often include `/runtime-endpoint/DEFAULT` — the route parses that into base ARN + `qualifier`.

**Example ARNs used in local/prod testing:**

| Agent | Env var | Example ARN |
|---|---|---|
| Planner | `RUNTIME_ARN_REQ_PLAN` | `arn:aws:bedrock-agentcore:eu-north-1:145928770924:runtime/RequestPlannerCode_request_plannerAgent-qyCsLd4U3V/runtime-endpoint/DEFAULT` |
| Developer | `RUNTIME_ARN_REQ_DEV` | `arn:aws:bedrock-agentcore:eu-north-1:145928770924:runtime/RequestDeveloperCode_request_developerAgent-Trd6xi53gz/runtime-endpoint/DEFAULT` |

---

## 3. Why Planner/Dev cannot simply “do what General/Order do” in the browser

AgentCore inbound auth is typically **either**:

- **JWT Bearer**, or  
- **IAM SigV4**  

…not both on the same runtime.

- General/Order harnesses are set up for **JWT** → browser can call them with the portal token.  
- Developer/Planner runtimes stay **IAM** so **other services can keep calling them with the AWS SDK**.  
- Putting IAM invoke in the browser would require AWS credentials in the client → **not acceptable**.  
- Switching those runtimes to JWT inbound would fix Amplify timeout but **break other SDK callers**.

Portal JWT on `/api/chat` (`withAuth`) only proves the user to **Icarus**. It does **not** mean the runtime accepts that JWT as AgentCore inbound auth.

---

## 4. Separate issue that was fixed: private git skill + workload token

Planner/Developer load skills from a **private** GitHub repo (`Artelis-Developers/360-AI-files`) via AgentCore Identity (`credentialArn` → PAT in token vault).

**Error when `runtimeUserId` was missing:**

```text
Failed to resolve git skill 'https://github.com/Artelis-Developers/360-AI-files':
Credential ARN resolution requires a workload access token
```

**Cause:** IAM `InvokeAgentRuntime` without an end-user id → AgentCore does not mint a **workload access token** → cannot read the PAT vault → git clone never runs.

**Fix (already in code for the runtime path):** pass `runtimeUserId` = verified Cognito `user.id` (`sub`) from `withAuth`.  
IAM also needs `bedrock-agentcore:InvokeAgentRuntimeForUser` (in addition to `InvokeAgentRuntime`) on `AgentCoreInvokeRole`.

This fix is **orthogonal** to the Amplify 30s timeout: skills can work and the request can still die if the run takes too long.

---

## 5. Why “store temporary in DynamoDB” alone does not fix SSR timeout

If Amplify still **waits** for `InvokeAgentRuntime` to finish, then writes Dynamo, then responds:

- Amplify is still blocked for the whole agent run  
- At ~30s the route is killed — often **before** a successful write  
- Dynamo is only storage; it does **not** keep Amplify alive  

Dynamo helps only as a **mailbox** when something else does the long work:

```text
Amplify: start job → return { taskId, status: RUNNING }   ← fast (<1s)
Worker (Lambda/ECS/…): InvokeAgentRuntime → write result somewhere
Browser: poll / fetch result later
```

**Also not reliable:** “agent closes the invoke early and keeps writing Dynamo in the same invocation.”  
When the `InvokeAgentRuntime` response stream ends, that invoke is done; background continuation of the same call is not a dependable AgentCore contract.

---

## 6. Potential fixes (for long-running Dev/Planner)

| Option | Idea | Pros | Cons |
|---|---|---|---|
| **A. Async job wrapper** | `/api/chat` returns immediately; longer-lived worker runs `InvokeAgentRuntime`; UI polls for result | Keeps IAM runtimes; fixes Amplify timeout | New worker + status API + UI “working…” state |
| **B. Move invoke off Amplify SSR** | Lambda / API / container with longer timeout still uses IAM + `runtimeUserId` | Same security model | New hosting for that API |
| **C. Browser JWT on those runtimes** | Like General/Order: browser → AgentCore directly | No Amplify wait | Usually drops IAM/SDK access on that runtime |
| **D. Shorten agent runs** | Faster skills / less tooling | No infra change | Unreliable for heavy work |
| **E. Accept limit** | Keep sync `/api/chat` | Simple | Long runs keep failing |

Boss sketch (async start):

```text
Amplify frontend
      │
      ▼
Amplify SSR route
      │  InvokeAgentRuntime (or enqueue worker)
      ▼
Developer / Planner Runtime
      ├── Returns quickly: { taskId, sessionId, status: "RUNNING" }   ← app-defined contract
      └── Continues in background (worker / separate job — not magic from InvokeAgentRuntime alone)
```

Note: stock `InvokeAgentRuntime` is a **streaming request/response**, not a native task queue. The `{ taskId, RUNNING }` shape is something **you build** around the call.

---

## 7. IAM / roles (AI account `145928770924`)

**Invoke role (assumed by Amplify):** `arn:aws:iam::145928770924:role/AgentCoreInvokeRole`  
Env: `AGENT_INVOKE_ROLE_ARN`, `AGENT_INVOKE_EXTERNAL_ID=agenticcore-prod`

Needed actions (identity policy on that role), including **endpoint** ARNs:

```json
{
  "Effect": "Allow",
  "Action": [
    "bedrock-agentcore:InvokeHarness",
    "bedrock-agentcore:InvokeAgentRuntime",
    "bedrock-agentcore:InvokeAgentRuntimeForUser"
  ],
  "Resource": [
    "arn:aws:bedrock-agentcore:eu-north-1:145928770924:harness/*",
    "arn:aws:bedrock-agentcore:eu-north-1:145928770924:runtime/*",
    "arn:aws:bedrock-agentcore:eu-north-1:145928770924:runtime/*/runtime-endpoint/*"
  ]
}
```

Exact resource match matters: allowing only  
`…:runtime/RequestPlannerCode_…`  
does **not** cover  
`…:runtime/RequestPlannerCode_…/runtime-endpoint/DEFAULT`.

Repo reference: `infra/template.yaml`.

---

## 8. Current product state (this repo)

- Sidebar live: **General Assistant**, **Order Agent** only (`src/client/lib/agents.ts`).  
- **Request Developer** / **Request Planner** parked (commented); restore by:
  1. Uncomment agents in `agents.ts` + icons  
  2. Uncomment `RUNTIME_ENV_BY_AGENT` in `src/server/api/chat/route.ts`  
  3. Uncomment `RUNTIME_ARN_REQ_*` echoes in `amplify.yml`  
  4. Set Amplify / `.env.local` runtime ARNs  
- Runtime invoke implementation (parse ARN, `runtimeUserId`, response → SSE) **remains** in `/api/chat` for when agents return.

---

## 9. Key files

| File | Role |
|---|---|
| `src/server/api/chat/route.ts` | `/api/chat` — IAM InvokeHarness + InvokeAgentRuntime, soft timeout 25s, `runtimeUserId` |
| `src/client/lib/stream.ts` | Client: JWT harness path vs `/api/chat` |
| `src/client/lib/agentcore.ts` | Browser InvokeHarness URL + JWT agent set |
| `src/client/lib/agents.ts` | Agent roster (parked Dev/Planner) |
| `amplify.yml` | Build-time env injection |
| `infra/template.yaml` | IAM template for invoke role |

---

## 10. One-line summary for stakeholders

**Amplify SSR cannot wait more than ~30s; Developer/Planner AgentCore runs often need longer and must use IAM via `/api/chat`, so sync invoke times out. Dynamo alone does not fix that. Fix = don’t wait on Amplify (async worker / other host) or use browser JWT (if IAM SDK callers can be dropped).**
