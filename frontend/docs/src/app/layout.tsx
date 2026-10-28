import type { Metadata } from "next";
import localFont from "next/font/local";
import { Sora } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

const inter = localFont({
  src: "./fonts/Inter-Variable.woff2",
  variable: "--font-inter",
  display: "swap",
  weight: "100 900",
});

// Sora SemiBold is only the logo's wordmark, as on aavishield.com.
const sora = Sora({ variable: "--font-sora", subsets: ["latin"], weight: ["600"], display: "swap" });

export const metadata: Metadata = {
  title: "Aavishield Documentation",
  description: "Complete setup and usage guide for the Aavishield Zero Trust Security Platform — company admins and employees.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} ${sora.variable}`}>
        <div className="flex min-h-screen bg-background">
          <Sidebar />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
