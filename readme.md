# AgentCore Chat

Chat interface for AWS Bedrock AgentCore Harness.

## Project Structure

```
agentcore-app/
├── app/                      ⚠️ Next.js entry points (thin wrappers)
│   ├── layout.tsx            → imports from src/client/styles
│   ├── page.tsx              → imports from src/client/pages
│   └── api/chat/route.ts     → re-exports from src/server
│
├── src/
│   ├── server/               🔒 BACKEND — do not mix with UI
│   │   └── api/chat/route.ts → Harness SSE streaming endpoint
│   │
│   └── client/               🎨 FRONTEND — do not touch backend logic
│       ├── components/       → UI building blocks (self-contained)
│       ├── hooks/            → React state logic
│       ├── lib/              → Framework-agnostic utilities
│       └── styles/           → Global tokens + app shell CSS
│
├── docs/                     📖 Architecture docs (read these!)
├── amplify.yml               → AWS Amplify build config
├── next.config.js            → Next.js configuration
└── tsconfig.json             → TypeScript config (path alias @/ → src/)
```

## Path Alias

All imports use `@/` which maps to `./src/`:

```ts
import { ChatHeader } from '@/client/components/ChatHeader';
```

## Key Rules

1. **`src/server/` is backend.** UI code never imports from here.
2. **`src/client/` is frontend.** No AWS SDK imports in this tree.
3. **`app/` is glue only.** Thin re-exports, no logic.

## Setup

```bash
npm install
npm run dev
```

## Environment Variables

Set on the Amplify app (both app-level and branch-level):

| Key | Example |
|---|---|
| `HARNESS_REGION` | `eu-north-1` |
| `HARNESS_ARN` | `arn:aws:bedrock-agentcore:eu-north-1:…:harness/…` |
| `BEDROCK_MODEL_ID` | `eu.amazon.nova-pro-v1:0` |
