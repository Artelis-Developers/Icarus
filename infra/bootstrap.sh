#!/usr/bin/env bash
set -euo pipefail

#
# AgentCore Chat — One-Shot Bootstrap Script
#
# Creates everything from scratch on a fresh AWS account:
#   1. Enables Bedrock model access (Nova Pro)
#   2. Creates AgentCore harness (via boto3 — CLI doesn't support it yet)
#   3. Deploys IAM role via CloudFormation
#   4. Creates Amplify app (WEB_COMPUTE, Next.js SSR)
#   5. Attaches compute role + sets env vars
#   6. Triggers first deploy
#
# Prerequisites:
#   - AWS CLI v2 configured (aws configure)
#   - Python 3 with boto3 (pip install boto3)
#   - A GitHub repo with the AgentCore app code pushed
#
# Usage:
#   chmod +x bootstrap.sh
#   ./bootstrap.sh \
#     --github-url https://github.com/USER/AgentCore.git \
#     --github-token ghp_xxxxxxxxxxxx
#
# Optional flags:
#   --region eu-north-1          (default)
#   --model eu.amazon.nova-pro-v1:0  (default)
#   --harness-name agentcore-chat    (default)
#   --app-name agentcore-chat        (default)
#

# ─── Defaults ───
REGION="eu-north-1"
MODEL_ID="eu.amazon.nova-pro-v1:0"
HARNESS_NAME="agentcore-chat"
APP_NAME="agentcore-chat"
GITHUB_URL=""
GITHUB_TOKEN=""

# ─── Parse Args ───
while [[ $# -gt 0 ]]; do
  case $1 in
    --region)        REGION="$2"; shift 2 ;;
    --model)         MODEL_ID="$2"; shift 2 ;;
    --harness-name)  HARNESS_NAME="$2"; shift 2 ;;
    --app-name)      APP_NAME="$2"; shift 2 ;;
    --github-url)    GITHUB_URL="$2"; shift 2 ;;
    --github-token)  GITHUB_TOKEN="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$GITHUB_URL" || -z "$GITHUB_TOKEN" ]]; then
  echo "ERROR: --github-url and --github-token are required"
  echo ""
  echo "Usage:"
  echo "  $0 --github-url https://github.com/USER/AgentCore.git --github-token ghp_xxx"
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   AgentCore Chat — Bootstrap                 ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ─── Account Info ───
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account:  $ACCOUNT_ID"
echo "Region:   $REGION"
echo "Model:    $MODEL_ID"
echo "GitHub:   $GITHUB_URL"
echo ""

# ─── Step 1: Enable Bedrock Model Access ───
echo "── Step 1/6: Enabling Bedrock model access ──"
# Try to enable Nova Pro inference profile
aws bedrock put-inference-profile \
  --region "$REGION" \
  --inference-profile-name "nova-pro-eu" \
  --description "Nova Pro cross-region for AgentCore" \
  --model-source '{"copyFrom": "amazon.nova-pro-v1:0"}' \
  --query 'inferenceProfile.inferenceProfileId' --output text 2>/dev/null && \
  echo "  ✓ Created inference profile 'nova-pro-eu'" || \
  echo "  ⊘ Inference profile may already exist or model not available in this region"

echo ""

# ─── Step 2: Create Harness ───
echo "── Step 2/6: Creating AgentCore harness ──"
HARNESS_INFO=$(python3 << PYEOF
import boto3, json, sys

client = boto3.client('bedrock-agentcore', region_name='$REGION')

# Check if harness already exists
try:
    runtimes = client.list_agent_runtimes()
    existing = [r for r in runtimes.get('agentRuntimes', []) if '$HARNESS_NAME' in r.get('agentRuntimeName', '')]
    if existing:
        r = existing[0]
        print(json.dumps({
            'runtimeId': r['agentRuntimeId'],
            'status': r.get('status', 'UNKNOWN'),
            'existed': True
        }))
        sys.exit(0)
except Exception:
    pass

# Create new harness
try:
    resp = client.create_agent_runtime(
        agentRuntimeName='$HARNESS_NAME',
        description='AgentCore Chat harness',
        containerImage={
            'imageUri': 'public.ecr.aws/i3m8p7z9/harness-$REGION:latest'
        },
        status='READY'
    )
    print(json.dumps({
        'runtimeId': resp['agentRuntime']['agentRuntimeId'],
        'status': resp['agentRuntime'].get('status', 'CREATING'),
        'existed': False
    }))
except Exception as e:
    # Fallback: just list what's available
    print(json.dumps({'error': str(e)}))
PYEOF
)

RUNTIME_ID=$(echo "$HARNESS_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin).get('runtimeId',''))" 2>/dev/null || echo "")
EXISTED=$(echo "$HARNESS_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin).get('existed','false'))" 2>/dev/null || echo "false")

if [[ -z "$RUNTIME_ID" ]]; then
  echo "  ⚠ Could not create harness automatically."
  echo "    Create it manually in the Bedrock Console → AgentCore → Harnesses"
  echo "    Then re-run this script with --skip-harness"
  echo ""
  echo "    Raw output: $HARNESS_INFO"
  exit 1
fi

if [[ "$EXISTED" == "True" ]]; then
  echo "  ✓ Harness already exists: $RUNTIME_ID"
else
  echo "  ✓ Created harness: $RUNTIME_ID"
fi

# The harness ARN uses a different suffix than the runtime ID
# Try to find it via CloudTrail or construct it
# For now, we'll use a wildcard pattern and let the user override
HARNESS_ARN="arn:aws:bedrock-agentcore:$REGION:$ACCOUNT_ID:harness/${HARNESS_NAME}-*"
echo "  ℹ Harness ARN pattern: $HARNESS_ARN"
echo "  ℹ If invoke fails, find the exact ARN in Bedrock Console"
echo ""

# ─── Step 3: Deploy IAM Role via CloudFormation ───
echo "── Step 3/6: Deploying IAM role (CloudFormation) ──"
STACK_NAME="agentcore-chat-iam"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_PATH="$SCRIPT_DIR/template.yaml"

aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --template-file "$TEMPLATE_PATH" \
  --parameter-overrides \
    AccountId="$ACCOUNT_ID" \
    Region="$REGION" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-disable-rollback \
  2>&1 | sed 's/^/  /'

COMPUTE_ROLE_ARN=$(aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[?OutputKey==`ComputeRoleArn`].OutputValue' \
  --output text)

echo "  ✓ Compute role: $COMPUTE_ROLE_ARN"
echo ""

# ─── Step 4: Create Amplify App ───
echo "── Step 4/6: Creating Amplify app ──"

# Check if app already exists
EXISTING_APP=$(aws amplify list-apps \
  --region "$REGION" \
  --query "apps[?name=='$APP_NAME'].appId" \
  --output text 2>/dev/null || echo "")

if [[ -n "$EXISTING_APP" && "$EXISTING_APP" != "None" ]]; then
  APP_ID="$EXISTING_APP"
  echo "  ✓ App already exists: $APP_ID"
else
  APP_ID=$(aws amplify create-app \
    --region "$REGION" \
    --name "$APP_NAME" \
    --platform WEB_COMPUTE \
    --repository "$GITHUB_URL" \
    --access-token "$GITHUB_TOKEN" \
    --environment-vars \
      HARNESS_REGION="$REGION" \
      HARNESS_ARN="$HARNESS_ARN" \
      BEDROCK_MODEL_ID="$MODEL_ID" \
    --query 'app.appId' \
    --output text)
  echo "  ✓ Created app: $APP_ID"
fi
echo ""

# ─── Step 5: Configure Compute Role + Branch ───
echo "── Step 5/6: Attaching compute role + creating branch ──"

# Attach compute role (this API isn't in CloudFormation)
aws amplify update-app \
  --region "$REGION" \
  --app-id "$APP_ID" \
  --compute-role-arn "$COMPUTE_ROLE_ARN" \
  >/dev/null 2>&1 && echo "  ✓ Compute role attached" || echo "  ⚠ Could not attach compute role (may need manual step)"

# Create or update branch
aws amplify create-branch \
  --region "$REGION" \
  --app-id "$APP_ID" \
  --branch-name "main" \
  --framework "Next.js - SSR" \
  --stage "PRODUCTION" \
  --environment-vars \
    HARNESS_REGION="$REGION" \
    HARNESS_ARN="$HARNESS_ARN" \
    BEDROCK_MODEL_ID="$MODEL_ID" \
  >/dev/null 2>&1 && echo "  ✓ Branch 'main' created" || \
  aws amplify update-branch \
    --region "$REGION" \
    --app-id "$APP_ID" \
    --branch-name "main" \
    --framework "Next.js - SSR" \
    --environment-vars \
      HARNESS_REGION="$REGION" \
      HARNESS_ARN="$HARNESS_ARN" \
      BEDROCK_MODEL_ID="$MODEL_ID" \
    >/dev/null 2>&1 && echo "  ✓ Branch 'main' updated"

echo ""

# ─── Step 6: Deploy ───
echo "── Step 6/6: Triggering first deploy ──"
JOB_ID=$(aws amplify start-job \
  --region "$REGION" \
  --app-id "$APP_ID" \
  --branch-name "main" \
  --job-type "RELEASE" \
  --query 'jobSummary.jobId' \
  --output text)

echo "  Job: $JOB_ID"
echo ""

# ─── Wait for deploy ───
echo "Waiting for deploy..."
for i in $(seq 1 20); do
  sleep 15
  STATUS=$(aws amplify get-job \
    --region "$REGION" \
    --app-id "$APP_ID" \
    --branch-name "main" \
    --job-id "$JOB_ID" \
    --query 'job.summary.status' \
    --output text)
  echo "  [$((i*15))s] $STATUS"
  if [[ "$STATUS" == "SUCCEED" ]]; then break; fi
  if [[ "$STATUS" == "FAILED" || "$STATUS" == "CANCELLED" ]]; then
    echo ""
    echo "  ✗ Deploy $STATUS"
    echo "  Check logs: https://$REGION.console.aws.amazon.com/amplify/home?region=$REGION#/$APP_ID/main/$JOB_ID"
    exit 1
  fi
done

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   ✓ Deploy Complete!                         ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "App ID:    $APP_ID"
echo "App URL:   https://main.$APP_ID.amplifyapp.com/"
echo "Role ARN:  $COMPUTE_ROLE_ARN"
echo ""
echo "Verify:"
echo "  curl -X POST https://main.$APP_ID.amplifyapp.com/api/chat \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"messages\":[{\"role\":\"user\",\"content\":\"Hello!\"}],\"sessionId\":\"test\"}'"
echo ""
