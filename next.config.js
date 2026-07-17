/** @type {import('next').NextConfig} */

/**
 * Iframe embedding policy — defense-in-depth for the portal auth model.
 *
 * CSP `frame-ancestors` is built from ALLOWED_ORIGINS — the SAME env var the
 * postMessage allowlist (`/api/auth/validate-origin`) uses. One var governs both
 * "who may embed us" (browser-enforced, here) and "whose messages we trust"
 * (app-enforced, there). Never hardcode origins; set ALLOWED_ORIGINS in Amplify
 * per environment (amplify.yml writes it into .env.production before build).
 *
 * Fail-closed: with origins configured we allow exactly those (plus 'self').
 * With NONE configured, development leaves framing OPEN (run inside a local
 * portal without config) but production falls back to 'none' so a misconfigured
 * deploy refuses all framing rather than letting any parent drive the handshake.
 *
 * The `@/` import alias resolves natively via tsconfig `paths` — no bundler
 * alias needed (and a `webpack` block would conflict with Next 16's Turbopack).
 */
const isDev = process.env.NODE_ENV === 'development';

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const frameAncestors =
  allowedOrigins.length > 0
    ? `frame-ancestors 'self' ${allowedOrigins.join(' ')};`
    : isDev
      ? 'frame-ancestors *;'
      : "frame-ancestors 'none';";

const nextConfig = {
  // Ensure Amplify build-time env is inlined into the client bundle.
  env: {
    NEXT_PUBLIC_AGENTCORE_REGION:
      process.env.NEXT_PUBLIC_AGENTCORE_REGION ||
      process.env.HARNESS_REGION ||
      'eu-north-1',
    NEXT_PUBLIC_AGENTCORE_QUALIFIER:
      process.env.NEXT_PUBLIC_AGENTCORE_QUALIFIER || 'DEFAULT',
    NEXT_PUBLIC_HARNESS_ARN: process.env.NEXT_PUBLIC_HARNESS_ARN || '',
    NEXT_PUBLIC_HARNESS_ARN_ORDER: process.env.NEXT_PUBLIC_HARNESS_ARN_ORDER || '',
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [{ key: 'Content-Security-Policy', value: frameAncestors }],
      },
    ];
  },
};

module.exports = nextConfig;
