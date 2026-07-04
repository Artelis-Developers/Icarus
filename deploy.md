# AgentCore Chat — Fresh Account Deployment Guide

Everything you need to replicate this setup on a new AWS account from zero.

---

## Prerequisites

| Item | Why |
|---|---|
| AWS account with admin/root access | Create resources |
| GitHub account | Host the app code |
| AWS CLI v2 installed | Run commands |
| `gh` CLI installed (optional) | Create repo via CLI |

---

## Step 1 — Choose Your Region

This guide uses `eu-north-1` (Stockholm). Supported AgentCore regions as of 2026-07:

- `eu-north-1` (Stockholm)
- `us-east-1` (N. Virginia)
- `us-west-2` (Oregon)

If you pick a different region, replace `eu-north-1` everywhere below.

---

## Step 2 — Enable Bedrock Model Access

You need to enable at least one model before the harness can use it.

1. Go to **Bedrock Console** → **Model access** in your region
2. Click **Manage model access**
3. Enable:
   - **Amazon Nova Pro** (`amazon.nova-pro-v1:0`) — available immediately
   - **Amazon Nova Lite** (`amazon.nova-lite-v1:0`) — fallback, cheaper
   - *(Optional)* **Anthropic Claude Sonnet 4.5** — requires submitting a use-case form, takes ~1-2 days for approval
4. Save changes. Models show **Access granted** when ready.

If you use cross-region inference profiles (recommended for eu-north-1), the model IDs are prefixed:
- `eu.amazon.nova-pro-v1:0`
- `eu.amazon.nova-lite-v1:0`
- `eu.anthropic.claude-sonnet-4-5-20250929-v1:0` (needs Anthropic use-case form)

---

## Step 3 — Create the Bedrock AgentCore Harness

### 3a. Create the harness

The easiest way is via the AWS Console:

1. Go to **Bedrock Console** → **AgentCore** → **Harnesses**
2. Click **Create harness**
3. Name it (e.g. `agentcore-chat`)
4. Select a container image (the default `public.ecr.aws/i3m8p7z9/harness-eu-north-1:latest` works)
5. Select your model
6. Create

### 3b. Or create via CLI

```bash
# Note: the CreateHarness API may not be in your CLI version yet.
# Use boto3 if the CLI lacks the command:

python3 -c "
import boto3, json

client = boto3.client('bedrock-agentcore', region_name='eu-north-1')

resp = client.create_agent_runtime(
    agentRuntimeName='agentcore-chat',
    # ... configure per your needs
)
print(json.dumps(resp, indent=2, default=str))
"
```

### 3c. Note the important values

After creation, you need:

| Value | Where to find it | Example |
|---|---|---|
| **Harness ARN** | Console → Harness details, or CloudTrail `CreateAgentRuntime` event → `X-Amzn-Bedrock-AgentCore-Source-Arn` | `arn:aws:bedrock-agentcore:eu-north-1:123456789012:harness/agentcore-chat-AbCdEfGhIj` |
| **Runtime ID** | Console → Runtime details, or `list_agent_runtimes` | `harness_agentcore-chat-XyZ1234567` |
| **Runtime Status** | Should be `READY` | |

> ⚠️ **Gotcha**: The harness ARN suffix differs from the runtime ID suffix. The harness ARN is what you pass to `InvokeHarness`. Find it via CloudTrail or the console harness detail page.

---

## Step 4 — Create the IAM Compute Role for Amplify

The Amplify SSR runtime needs permission to invoke the harness and Bedrock models.

### 4a. Trust policy

Save as `trust-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "amplify.amazonaws.com"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "aws:SourceAccount": "YOUR_ACCOUNT_ID"
        }
      }
    },
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "compute.amplify.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

### 4b. Permission policy

Save as `role-policy.json` (replace `YOUR_ACCOUNT_ID` and `YOUR_REGION`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvokeHarness",
      "Effect": "Allow",
      "Action": [
        "bedrock-agentcore:InvokeHarness",
        "bedrock-agentcore:InvokeAgentRuntime",
        "bedrock-agentcore:InvokeAgentRuntimeForUser"
      ],
      "Resource": [
        "arn:aws:bedrock-agentcore:YOUR_REGION:YOUR_ACCOUNT_ID:harness/*",
        "arn:aws:bedrock-agentcore:YOUR_REGION:YOUR_ACCOUNT_ID:runtime/*"
      ]
    },
    {
      "Sid": "BedrockInvoke",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:*::foundation-model/*",
        "arn:aws:bedrock:YOUR_REGION:YOUR_ACCOUNT_ID:*",
        "arn:aws:bedrock:YOUR_REGION::*"
      ]
    },
    {
      "Sid": "BedrockInferenceProfile",
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": "arn:aws:bedrock:YOUR_REGION:YOUR_ACCOUNT_ID:inference-profile/*"
    }
  ]
}
```

### 4c. Create the role

```bash
# Create role
aws iam create-role \
  --role-name AmplifyAgentCoreChatRole \
  --assume-role-policy-document file://trust-policy.json

# Attach inline policy
aws iam put-role-policy \
  --role-name AmplifyAgentCoreChatRole \
  --policy-name AmplifyAgentCoreInvoke \
  --policy-document file://role-policy.json

# Note the ARN
echo "Role ARN: arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/AmplifyAgentCoreChatRole"
```

---

## Step 5 — Create the GitHub Repo

```bash
# Option A: via gh CLI
gh repo create YOUR_USERNAME/AgentCore --public --clone
cd AgentCore

# Option B: create manually on github.com, then clone
```

Copy the app code from <https://github.com/RoyHolzem/AgentCore> into your new repo and push it.

---

## Step 6 — Create the Amplify App

### 6a. Create app

```bash
APP_ID=$(aws amplify create-app \
  --name "agentcore-chat" \
  --platform WEB_COMPUTE \
  --repository "https://github.com/YOUR_USERNAME/AgentCore.git" \
  --iam-service-role-arn "arn:aws:iam::YOUR_ACCOUNT_ID:role/service-role/AmplifySSRLoggingRole" \
  --compute-role-arn "arn:aws:iam::YOUR_ACCOUNT_ID:role/AmplifyAgentCoreChatRole" \
  --query 'app.appId' --output text)

echo "App ID: $APP_ID"
```

> **Note**: You also need an Amplify service role (`AmplifySSRLoggingRole`) for build permissions. If you don't have one, the AWS Console setup wizard creates it automatically — often easier than CLI.

### 6b. Create branch

```bash
aws amplify create-branch \
  --app-id "$APP_ID" \
  --branch-name "main" \
  --framework "Next.js - SSR" \
  --stage "PRODUCTION"
```

### 6c. Set environment variables

```bash
aws amplify update-app \
  --app-id "$APP_ID" \
  --custom-rules '[]' \
  --environment-vars \
    platform=WEB_COMPUTE \
    HARNESS_REGION=eu-north-1 \
    HARNESS_ARN=arn:aws:bedrock-agentcore:eu-north-1:YOUR_ACCOUNT_ID:harness/YOUR_HARNESS_ID \
    BEDROCK_MODEL_ID=eu.amazon.nova-pro-v1:0

# Also set at branch level
aws amplify update-branch \
  --app-id "$APP_ID" \
  --branch-name "main" \
  --environment-vars \
    HARNESS_REGION=eu-north-1 \
    HARNESS_ARN=arn:aws:bedrock-agentcore:eu-north-1:YOUR_ACCOUNT_ID:harness/YOUR_HARNESS_ID \
    BEDROCK_MODEL_ID=eu.amazon.nova-pro-v1:0
```

---

## Step 7 — Connect GitHub for Auto-Deploy

### Option A: Via Amplify Console (recommended)

1. Open your app in **Amplify Console**
2. Go to **App settings** → **General** → **Edit**
3. Connect to GitHub
4. Select your repo and branch
5. Amplify sets up the webhook automatically

### Option B: Via GitHub Webhook

If you used `create-app` with a personal access token (`--access-token`), Amplify creates the webhook for you.

---

## Step 8 — Deploy

```bash
# Trigger first build
aws amplify start-job \
  --app-id "$APP_ID" \
  --branch-name "main" \
  --job-type "RELEASE"

# Monitor
aws amplify get-job \
  --app-id "$APP_ID" \
  --branch-name "main" \
  --job-id $(aws amplify list-jobs --app-id "$APP_ID" --branch-name "main" --max-results 1 --query 'jobSummaries[0].jobId' --output text) \
  --query 'job.summary.status' --output text
```

Your app is live at `https://main.<APP_ID>.amplifyapp.com/`.

---

## Step 9 — Verify

```bash
# Test the API endpoint directly
curl -X POST https://main.<APP_ID>.amplifyapp.com/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}],"sessionId":"test-1234"}'
```

You should get SSE-streamed text back.

---

## Checklist (print this)

```
[ ] 1. Bedrock model access enabled (at least Nova Pro)
[ ] 2. AgentCore harness created and status = READY
[ ] 3. Harness ARN noted (different suffix than runtime ID!)
[ ] 4. IAM role "AmplifyAgentCoreChatRole" created
      - Trust: amplify.amazonaws.com + compute.amplify.amazonaws.com
      - Permissions: InvokeHarness + bedrock:InvokeModel
[ ] 5. GitHub repo created with app code pushed
[ ] 6. Amplify app created (platform: WEB_COMPUTE, framework: Next.js - SSR)
[ ] 7. Compute role ARN attached to Amplify app
[ ] 8. Environment variables set:
      - HARNESS_REGION
      - HARNESS_ARN
      - BEDROCK_MODEL_ID
[ ] 9. GitHub webhook connected for auto-deploy
[ ] 10. First deploy succeeded (status: SUCCEED)
[ ] 11. /api/chat responds with streamed text
```

---

## Gotchas We Hit (so you don't have to)

| Problem | Solution |
|---|---|
| **Amplify 404 on pages** | Platform must be `WEB_COMPUTE`, not `WEB`. Static hosting can't do SSR API routes. |
| **Framework detection fails** | Set framework explicitly to `Next.js - SSR` |
| **`npm ci` fails on Amplify** | `package-lock.json` must be in sync with `package.json`. Run `npm install` before committing. |
| **SSR env vars missing** | Set them at BOTH app-level and branch-level. Also inline via `next.config.js` `env` block — Amplify SSR doesn't reliably pass env vars to the runtime. |
| **Harness ARN not found** | The ARN suffix differs from the runtime ID. Check CloudTrail `CreateAgentRuntime` event → `X-Amzn-Bedrock-AgentCore-Source-Arn` header. |
| **Anthropic models error** | Need to submit an Anthropic use-case form in Bedrock Console → Model access. Takes 1-2 days. Use Nova Pro meanwhile. |
| **Harness bleeds system prompt** | The container image has a baked-in system prompt. Pass `systemPrompt` in `InvokeHarnessCommand` to override. |
| **`<thinking>` tags in output** | Some models (Nova Pro) stream thinking tags. Filter them client-side if they bother you. |
| **Python not on Amplify** | Amplify compute runs Node.js only. Use `@aws-sdk/client-bedrock-agentcore` (JS), not boto3. |

---

## File Inventory

The repo (`https://github.com/RoyHolzem/AgentCore`) contains:

```
app/                          Next.js entry points (thin glue)
  layout.tsx                  Root HTML + metadata
  page.tsx                    Re-exports ChatPage from src/client
  api/chat/route.ts           Re-exports POST from src/server

src/
  server/api/chat/route.ts    🔒 Harness SSE streaming endpoint
  client/
    components/               UI building blocks (5 self-contained)
    hooks/usechat.ts          React state + stream orchestration
    lib/stream.ts             Framework-agnostic SSE parser
    pages/chatpage.tsx        Main page composition
    styles/                   Design tokens + CSS modules

amplify.yml                   Build config (npm ci && npm run build)
next.config.js                Env inlining + @/ path alias
package.json                  Next 14.2.30, AWS SDK client
tsconfig.json                 Path alias @/ → ./src/
docs/                         Architecture docs
```
