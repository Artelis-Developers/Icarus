import { NextRequest } from 'next/server';
import { BedrockAgentCoreClient, InvokeHarnessCommand } from '@aws-sdk/client-bedrock-agentcore';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { withAuth } from '@artelis/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const REGION = process.env.HARNESS_REGION || 'eu-north-1';
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'eu.amazon.nova-pro-v1:0';

// Set only in a cross-account frontend (e.g. prod Amplify in a separate account).
// When empty, the client uses its own ambient identity — the same-account behaviour.
const AGENT_INVOKE_ROLE_ARN = process.env.AGENT_INVOKE_ROLE_ARN || '';
const AGENT_INVOKE_EXTERNAL_ID = process.env.AGENT_INVOKE_EXTERNAL_ID || 'agenticcore-prod';

/** Env var name per UI agent id — resolved at request time (not module load). */
const HARNESS_ENV_BY_AGENT: Record<string, string> = {
  general: 'HARNESS_ARN',
  dev: 'HARNESS_ARN_REQ_DEV',
  order: 'HARNESS_ARN_ORDER',
  req_prio: 'HARNESS_ARN_REQ_PRIO',
  req_plan: 'HARNESS_ARN_REQ_PLAN',
};

function getClient() {
  // Same account: no role to assume — use the ambient compute-role credentials.
  if (!AGENT_INVOKE_ROLE_ARN) {
    return new BedrockAgentCoreClient({ region: REGION });
  }
  // Cross account: assume the invoke role in the agent account first, then act as it.
  return new BedrockAgentCoreClient({
    region: REGION,
    credentials: fromTemporaryCredentials({
      params: {
        RoleArn: AGENT_INVOKE_ROLE_ARN,
        RoleSessionName: 'agenticcore-prod-frontend',
        ExternalId: AGENT_INVOKE_EXTERNAL_ID,
        DurationSeconds: 3600,
      },
    }),
  });
}

function resolveHarnessArn(agentId?: string): string {
  const id = agentId || 'general';
  const envKey = HARNESS_ENV_BY_AGENT[id];

  // Known agent → must have its own ARN. Never silently fall back to general
  // (empty string used to be falsy and always routed to HARNESS_ARN).
  if (envKey) {
    const arn =
      process.env[envKey] ||
      (id === 'req_prio' ? process.env.HARNESS_ARN__REQ_PRIO : undefined) ||
      '';
    if (!arn) {
      throw new Error(`Harness ARN not configured for agent "${id}" (set ${envKey})`);
    }
    return arn;
  }

  const fallback = process.env.HARNESS_ARN || '';
  if (!fallback) {
    throw new Error(`No harness configured for agent "${id}"`);
  }
  return fallback;
}

// withAuth verifies the portal Cognito JWT (JWKS + tenant directory lookup)
// before the harness is ever invoked — the trust boundary for this app, since
// there is no Lambda behind it. The verified identity (`_user`) isn't needed by
// the harness call itself; the point is that anonymous callers are rejected.
export const POST = withAuth(async (req: NextRequest, _user) => {
  const body = await req.json();
  const { messages, sessionId, agentId } = body;

  if (!messages || !Array.isArray(messages)) {
    return Response.json({ error: 'messages array required' }, { status: 400 });
  }

  let harnessArn: string;
  try {
    harnessArn = resolveHarnessArn(agentId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 400 });
  }

  console.log(
    `[chat] agentId=${agentId ?? '(none)'} → harness=${harnessArn.split('/').pop()}`
  );

  const harnessMessages = messages.map((m: { role: string; content: string }) => ({
    role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
    content: [{ text: m.content }],
  }));

  const sid = sessionId || crypto.randomUUID();

  const command = new InvokeHarnessCommand({
    harnessArn,
    runtimeSessionId: sid,
    messages: harnessMessages,
    model: {
      bedrockModelConfig: {
        modelId: MODEL_ID,
      },
    },
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const client = getClient();
        const response = await client.send(command);

        for await (const event of response.stream) {
          if (event.contentBlockDelta) {
            const delta = event.contentBlockDelta.delta;
            if (delta?.text) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'text', text: delta.text })}\n\n`)
              );
            }
          } else if (event.messageStop) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'stop', reason: event.messageStop.stopReason })}\n\n`)
            );
          } else if (event.metadata) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'metadata', usage: event.metadata.usage })}\n\n`)
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`)
        );
      }

      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});
