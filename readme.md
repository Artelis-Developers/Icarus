# AgentCore Chat

Chat interface for AWS Bedrock AgentCore Harness.

## Setup

```bash
npm install
npm run dev
```

Set these environment variables:

- `AWS_REGION` — e.g. `eu-north-1`
- `HARNESS_ARN` — the full harness ARN
- `BEDROCK_MODEL_ID` — inference profile ID (e.g. `eu.anthropic.claude-sonnet-4-5-20250929-v1:0`)

## Deploy on AWS Amplify

Connect this repo in Amplify Console. Build settings are auto-detected.
