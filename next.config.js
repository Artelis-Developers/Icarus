/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    HARNESS_REGION: process.env.HARNESS_REGION || 'eu-north-1',
    HARNESS_ARN: process.env.HARNESS_ARN || '',
    HARNESS_ARN_REQ_DEV: process.env.HARNESS_ARN_REQ_DEV || '',
    BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID || 'eu.amazon.nova-pro-v1:0',
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
