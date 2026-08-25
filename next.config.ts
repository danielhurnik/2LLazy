import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle with only the dependencies actually
  // reached at runtime, so the container image does not ship node_modules.
  // See docs/SELF_HOSTING.md and the Dockerfile.
  output: "standalone",
  turbopack: {
    root: path.resolve(__dirname),
  },
  // These packages rely on native binaries, large files, or Node.js-specific
  // globals that must not be bundled by webpack
  serverExternalPackages: ["pdf-parse", "formidable", "pg"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Long-lived cache headers for immutable Next.js static chunks
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/public/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
    ];
  },
};

export default nextConfig;
