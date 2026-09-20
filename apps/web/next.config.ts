import type { NextConfig } from "next";

// The web app and the API share one domain, so cookies are same-site.
// Requests to /api/* are proxied to Django. API_ORIGIN is where Django runs.
const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // Every Django API route ends in a slash. Next.js drops the slash from the
  // matched path, so the destination adds it back. Without it Django redirects
  // to the slash form and the browser loops.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*/` }];
  },
};

export default nextConfig;
