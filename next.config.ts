import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Content Security Policy: only this site's own scripts, plus Cloudflare Turnstile (bot check).
 * The only external media is the hero video (CloudFront). 'unsafe-inline' scripts are needed by
 * Next's inline bootstrap; 'unsafe-eval' and ws: only by the dev server's hot reload.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' https://d8j0ntlcm91z4.cloudfront.net",
  "font-src 'self' data:",
  `connect-src 'self' https://challenges.cloudflare.com${isDev ? " ws:" : ""}`,
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Excel writer (cycle report): load from node_modules at runtime instead of bundling it.
  serverExternalPackages: ["exceljs", "nodemailer", "pdf-lib", "@pdf-lib/fontkit"],
  // The weekly PDF report reads its Vietnamese font files from disk at runtime.
  outputFileTracingIncludes: {
    "/api/admin/signals/report": ["./src/backend/fonts/*.ttf"],
  },
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // Older browsers that ignore frame-ancestors: never show this site inside a frame.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
        ],
      },
      // Never cache anything personal or authenticated.
      ...["/api/me", "/api/register", "/api/verify-otp", "/api/auth/logout", "/api/unsubscribe", "/api/admin/:path*"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "no-store" }],
      })),
    ];
  },
};

export default nextConfig;
