import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  compress: true,
  // Link otherwise attaches onTouchStart only on the client, which React 19
  // reports as a hydration mismatch on every <Link>.
  experimental: { linkNoTouchStart: true },
  images: {
    formats: ["image/avif", "image/webp"],
    // Up to the screenshots' own 2880px width, so console captures stay sharp on
    // high-density screens.
    deviceSizes: [390, 640, 828, 1080, 1280, 1600, 1920, 2560, 2880],
    // 90 is used for console screenshots, where small UI text must stay crisp.
    qualities: [75, 90],
    imageSizes: [96, 160, 256, 320, 480],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  async headers() {
    return [
      {
        source: "/brand/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
      {
        source: "/images/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
