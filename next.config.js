/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    HARNESS_REGION: process.env.HARNESS_REGION || 'eu-north-1',
    HARNESS_ARN: process.env.HARNESS_ARN || '',
    HARNESS_ARN_REQ_DEV: process.env.HARNESS_ARN_REQ_DEV || '',
    HARNESS_ARN_ORDER: process.env.HARNESS_ARN_ORDER || '',
    HARNESS_ARN_REQ_PRIO: process.env.HARNESS_ARN_REQ_PRIO || process.env.HARNESS_ARN__REQ_PRIO || '',
    HARNESS_ARN__REQ_PRIO: process.env.HARNESS_ARN__REQ_PRIO || '',
    HARNESS_ARN_REQ_PLAN: process.env.HARNESS_ARN_REQ_PLAN || '',
    BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID || 'eu.amazon.nova-pro-v1:0',
    // Cross-account: role in the agent account the frontend assumes before invoking.
    // Empty in same-account/dev — the client then uses its own ambient identity.
    AGENT_INVOKE_ROLE_ARN: process.env.AGENT_INVOKE_ROLE_ARN || '',
    AGENT_INVOKE_EXTERNAL_ID: process.env.AGENT_INVOKE_EXTERNAL_ID || 'agenticcore-prod',
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': require('path').resolve(__dirname, 'src'),
    };
    return config;
  },
};

module.exports = nextConfig;
