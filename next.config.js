/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    HARNESS_ARN: process.env.HARNESS_ARN || '',
    HARNESS_REGION: process.env.HARNESS_REGION || 'eu-north-1',
    BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID || '',
  },
};

module.exports = nextConfig;
