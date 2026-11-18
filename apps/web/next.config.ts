import type { NextConfig } from 'next';

/**
 * Where the web server forwards `/api/*`. In production the reverse proxy should route `/api`
 * straight to the api container; this rewrite covers local dev and a proxy that sends
 * everything to the web container. Read at build time, so pass it as a build arg in Docker.
 */
const apiOrigin = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default config;
