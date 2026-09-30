import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Footer } from "@/components/footer";
import { Nav } from "@/components/nav";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://delsecure.aavishailab.com"),
  title: {
    default: "DelSecure | Endpoint security for every device",
    template: "%s | DelSecure",
  },
  description:
    "One lightweight agent on every laptop enforces web, data, application and device policy for your company, on any network.",
  openGraph: {
    title: "DelSecure | Endpoint security for every device",
    description: "Web gateway, DLP, application control, VPN control, malware scanning and device posture in one agent.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="min-h-[100dvh] overflow-x-clip">
        <ThemeProvider>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-invert-bg focus:px-4 focus:py-2 focus:text-invert-fg">
            Skip to content
          </a>
          <Nav />
          <main id="main">{children}</main>
          <Footer />
          <div aria-hidden className="grain pointer-events-none fixed inset-0 z-50" />
        </ThemeProvider>
      </body>
    </html>
  );
}
