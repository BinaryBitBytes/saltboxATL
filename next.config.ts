import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["html5-qrcode"],
  experimental: {
    proxyClientMaxBodySize: "12mb",
  },
};

export default nextConfig;
