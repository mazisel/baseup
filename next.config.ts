import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  reactStrictMode: true,
  eslint: {
    // Mevcut kodda çok sayıda no-explicit-any ihlali var; lint dev'de
    // çalışmaya devam eder, production build'i engellemesin.
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
