import type { Metadata, Viewport } from "next";
import { Dancing_Script, Instrument_Serif, Inter } from "next/font/google";
import "./globals.css";

// Inter and Dancing Script ship Vietnamese glyphs; Instrument Serif is Latin-only,
// so it is reserved for the English display lines.
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

const dancing = Dancing_Script({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dancing",
  display: "swap",
});

export const metadata: Metadata = {
  title: "The Last Candle · Khu vực thành viên",
  description: "Theo dõi khối lượng giao dịch 30 ngày và tin tức cộng đồng The Last Candle.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0608",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${inter.variable} ${instrument.variable} ${dancing.variable}`}>
      <body>{children}</body>
    </html>
  );
}
