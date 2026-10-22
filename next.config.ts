import type { NextConfig } from "next";
import path from "path";

const ONE_YEAR_SECONDS = 31_536_000;
const UNBUNDLEABLE_SERVER_PACKAGES = ["pdf-parse", "node-notifier"];
const chunkUrlsAreContentHashed = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  serverExternalPackages: UNBUNDLEABLE_SERVER_PACKAGES,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async headers() {
    if (!chunkUrlsAreContentHashed) return [];
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: `public, max-age=${ONE_YEAR_SECONDS}, immutable` },
        ],
      },
    ];
  },
};

export default nextConfig;
