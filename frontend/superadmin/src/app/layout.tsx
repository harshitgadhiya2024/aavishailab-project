import type { Metadata } from "next";
import localFont from "next/font/local";
import { DM_Mono, Sora } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "sonner";

const inter = localFont({
  src: "./fonts/Inter-Variable.woff2",
  variable: "--font-inter",
  display: "swap",
  weight: "100 900",
});

// Sora SemiBold is only the logo's wordmark, as on aavishield.com.
const sora = Sora({ variable: "--font-sora", subsets: ["latin"], weight: ["600"], display: "swap" });
// The website's mono face, for labels, eyebrows and buttons. Headings use
// Satoshi (Fontshare, as on aavishield.com), linked in <head> below.
const dmMono = DM_Mono({ variable: "--font-dm-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export const metadata: Metadata = {
  title: "Aavishield — Superadmin",
  description: "Aavishield Zero Trust Security Platform — Superadmin Console",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="" />
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap" />
      </head>
      <body className={`${inter.className} ${inter.variable} ${sora.variable} ${dmMono.variable}`}>
        <Providers>
          {children}
          <Toaster position="top-right" richColors />
        </Providers>
      </body>
    </html>
  );
}
