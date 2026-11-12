import { join } from 'node:path';
import type { NextConfig } from 'next';
import { apiInternalUrl } from './lib/api/internal-url';

const nextConfig: NextConfig = {
  // The smoke launcher builds into its own directory, so a smoke run never
  // collides with a dev server running in the same checkout.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  transpilePackages: ['@arena/shared'],
  // The production image runs the self-contained server `next build` writes to
  // .next/standalone, traced from the workspace root (apps/web/Dockerfile).
  output: 'standalone',
  outputFileTracingRoot: join(__dirname, '..', '..'),
  // The browser only ever talks to this app; /api/* is forwarded to the API
  // process, which serves every route under /api.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternalUrl()}/api/:path*` }];
  },
};

export default nextConfig;
