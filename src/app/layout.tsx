import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Inter } from "next/font/google";
import "./globals.css";

// Inter ships Vietnamese glyphs; Instrument Serif is Latin-only,
// so it is reserved for the English display lines and the wordmark.
const inter = Inter({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-inter",
  display: "swap",
});

const instrument = Instrument_Serif({
  subsets: ["latin", "latin-ext"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument",
  display: "swap",
});

const TITLE = "The Last Candle · Khu vực thành viên";
const DESCRIPTION = "Theo dõi khối lượng giao dịch BingX theo chu kỳ nửa tháng và nhận nhắc hạn qua Gmail.";

/** Absolute links for the share preview. A malformed SITE_URL must not break the build. */
function siteBase(): URL {
  try {
    return new URL(process.env.SITE_URL || "https://crypto-the-last-candle.vercel.app");
  } catch {
    return new URL("https://crypto-the-last-candle.vercel.app");
  }
}

export const metadata: Metadata = {
  metadataBase: siteBase(),
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: false, follow: false },
  // The preview image comes from opengraph-image.png in this folder.
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/", siteName: "The Last Candle", locale: "vi_VN", type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: "#0a0608",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${inter.variable} ${instrument.variable}`}>
      <body>{children}</body>
    </html>
  );
}
