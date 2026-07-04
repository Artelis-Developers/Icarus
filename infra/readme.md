# Infrastructure

One-shot deployment for AgentCore Chat on a fresh AWS account.

## What Gets Created

| Resource | How | CloudFormation? |
|---|---|---|
| Bedrock model access | CLI (inference profile) | ❌ (console/API only) |
| AgentCore harness | boto3 (`create_agent_runtime`) | ❌ (no CFN resource type yet) |
| IAM role (compute) | ✅ CloudFormation (`template.yaml`) | ✅ |
| Amplify app | AWS CLI (`create-app`) | ❌ (needs GitHub OAuth token) |
| Amplify branch + env vars | AWS CLI (`create-branch`) | ❌ (compute role not a CFN property) |
| Auto-deploy webhook | Amplify (via access token) | ❌ |

## Why Not Pure CloudFormation?

Three blockers:
1. **No `AWS::Bedrock::AgentCoreHarness`** resource type
2. **No `ComputeRoleArn`** property on `AWS::Amplify::App`
3. **GitHub OAuth** tokens can't be cleanly managed in CFN

The CFN template (`template.yaml`) handles the IAM role (the part that benefits most from IaC). The script handles the rest.

## Usage

```bash
cd infra/

# Make executable
chmod +x bootstrap.sh

# Run it
./bootstrap.sh \
  --github-url https://github.com/YOUR_USERNAME/AgentCore.git \
  --github-token ghp_your_token_here
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--region` | `eu-north-1` | AWS region |
| `--model` | `eu.amazon.nova-pro-v1:0` | Bedrock model ID |
| `--harness-name` | `agentcore-chat` | Harness name |
| `--app-name` | `agentcore-chat` | Amplify app name |
| `--github-url` | *(required)* | Your repo URL |
| `--github-token` | *(required)* | GitHub PAT with repo access |

### What You Need First

- AWS CLI v2 configured (`aws configure`)
- Python 3 + boto3 (`pip install boto3`)
- The app code pushed to a GitHub repo (clone from `RoyHolzem/AgentCore`)
- A GitHub Personal Access Token with `repo` scope

### After It Finishes

Your app is live at `https://main.<APP_ID>.amplifyapp.com/`.

The harness ARN is set as a wildcard (`harness/agentcore-chat-*`). If invoke fails, find the exact ARN in Bedrock Console and update the env var.
