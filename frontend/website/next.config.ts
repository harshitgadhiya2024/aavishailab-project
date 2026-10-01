import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  compress: true,
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [390, 640, 828, 1080, 1280, 1600, 1920],
    imageSizes: [96, 160, 256, 320, 480],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  // The site moved from delsecure.aavishailab.com to aavishield.aavishailab.com
  // with the rebrand. The old hostname still reaches this app (cloudflared),
  // and every path on it is permanently redirected to the same path on the
  // new one, so old links, bookmarks and search results keep working.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "delsecure.aavishailab.com" }],
        destination: "https://aavishield.aavishailab.com/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
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
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
