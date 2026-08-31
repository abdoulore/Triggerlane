import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@ghost/domain"],
  agentRules: false,
  async rewrites() {
    const apiOrigin = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
    return [
      { source: "/api/:path*", destination: `${apiOrigin}/api/:path*` },
      { source: "/health", destination: `${apiOrigin}/health` },
      { source: "/health/:path*", destination: `${apiOrigin}/health/:path*` },
    ];
  },
};

export default nextConfig;
