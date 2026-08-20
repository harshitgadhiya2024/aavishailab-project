/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:6000",
    NEXT_PUBLIC_AI_URL: process.env.NEXT_PUBLIC_AI_URL || "http://localhost:6002",
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:6000",
  },
};
module.exports = nextConfig;
