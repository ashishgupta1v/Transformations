import type { NextConfig } from "next";

// ADMIN_API_URL is read server-side only (rewrites() runs in the Next.js
// server process, never bundled to the browser) so it's safe to point at
// an internal Docker hostname. Defaults to localhost for `next dev`
// against `npm run admin`. docker-compose.prod.yml sets this to
// http://engine:3000 so the dashboard container can reach the engine
// container by service name instead of localhost (which inside a
// container refers to the container itself, not the host).
const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://localhost:3000';

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${ADMIN_API_URL}/api/:path*`,
      },
      {
        // Lets the dashboard's <video> preview hit /output/<file>.mp4 the
        // same way it hits /api/* — proxied through to the admin engine,
        // which serves OUTPUT_DIR statically (see admin/server.js).
        source: '/output/:path*',
        destination: `${ADMIN_API_URL}/output/:path*`,
      },
    ];
  },
};

export default nextConfig;
