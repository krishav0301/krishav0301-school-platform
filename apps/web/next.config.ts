import type { NextConfig } from "next";

// Production is a static export: plain files served by the Worker, which also serves /api/*
// on the same origin (D-021). There is no Next.js server.
//
// In development only, `next dev` forwards /api/* to `wrangler dev` so the page and the API
// share one origin here too. Rewrites are not allowed in an export build.
const isProduction = process.env.NODE_ENV === "production";
const workerOrigin = process.env.WORKER_ORIGIN ?? "http://localhost:8787";

const nextConfig: NextConfig = isProduction
  ? { output: "export", experimental: { cssChunking: "graph" } }
  : {
      // Next blocks dev-only requests (HMR, assets) from a hostname other than the one the server
      // started on. `localhost` is allowed by default; `127.0.0.1` is a different hostname to it
      // and needs its own entry, or the dev client falls back to reloading the page in a loop.
      allowedDevOrigins: ["127.0.0.1"],
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${workerOrigin}/api/:path*` }];
      },
    };

export default nextConfig;
