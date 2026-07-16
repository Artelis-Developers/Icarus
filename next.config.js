/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server env vars come from `.env.local` (dev) or `.env.production`
  // written by amplify.yml at build time — do not inline them here.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': require('path').resolve(__dirname, 'src'),
    };
    return config;
  },
};

module.exports = nextConfig;
