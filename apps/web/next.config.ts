import type { NextConfig } from "next";

/** Server-rendered (no static export); images are served as-is from the api and FOC sources. */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  transpilePackages: ["@stamper/core", "@stamper/contracts-abi", "@stamper/minimise"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
