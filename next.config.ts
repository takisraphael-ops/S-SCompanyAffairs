import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The `postgres` driver is server-only; keep it out of any client bundle.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
