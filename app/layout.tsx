import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Valooro Handwerk",
  description: "Valooro Handwerk",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#3A3A3A",
  // iOS: Layout-Viewport bis an die physischen Bildschirmränder ziehen, damit
  // `env(safe-area-inset-*)` reale Werte (> 0) liefert. Voraussetzung dafür, dass
  // die fixe Bottom-Tab-Nav (Mobile) stabil am unteren Rand klebt (sonst wandert
  // sie auf iOS Safari mit der dynamischen Toolbar) und sauber über dem
  // Home-Indicator sitzt.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" className={plusJakartaSans.variable}>
      <body>{children}</body>
    </html>
  );
}
