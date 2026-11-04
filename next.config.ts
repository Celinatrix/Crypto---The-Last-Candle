import type { NextConfig } from "next";

/**
 * Member routes live on a separate backend. With BACKEND_URL set, they are proxied
 * same-origin so the backend's httpOnly member cookie stays first-party.
 * Read at build time: on Vercel, set it in Project → Settings → Environment Variables.
 */
const BACKEND_URL = process.env.BACKEND_URL?.trim().replace(/\/+$/, "");
const BACKEND_ROUTES = ["/api/me", "/api/register", "/api/news", "/api/auth/logout"];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    if (!BACKEND_URL) return [];
    return BACKEND_ROUTES.map((source) => ({ source, destination: `${BACKEND_URL}${source}` }));
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
