import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Footer } from "@/components/footer";
import { Nav } from "@/components/nav";
import { SiteLoader, loaderGateScript } from "@/components/site-loader";
import { ThemeProvider } from "@/components/theme-provider";
import { JsonLd, SITE_NAME, SITE_URL } from "@/lib/seo";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Aavishield | Endpoint Security, DLP and Web Filtering for Every Device",
    template: "%s | Aavishield",
  },
  description:
    "Aavishield is endpoint security for companies. One lightweight agent enforces web filtering, data loss prevention, application control, VPN blocking, malware scanning and device posture on macOS, Windows and Linux.",
  applicationName: SITE_NAME,
  keywords: [
    "endpoint security",
    "secure web gateway",
    "data loss prevention",
    "DLP",
    "application control",
    "VPN blocking",
    "malware scanning",
    "device posture",
    "employee monitoring",
    "zero trust",
  ],
  authors: [{ name: "Aavish AI Lab" }],
  creator: "Aavish AI Lab",
  category: "technology",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: "/",
    title: "Aavishield | Endpoint security for every device",
    description: "Web gateway, DLP, application control, VPN control, malware scanning and device posture in one agent.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Aavishield | Endpoint security for every device",
    description: "Web gateway, DLP, application control, VPN control, malware scanning and device posture in one agent.",
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  formatDetection: { telephone: false, email: false, address: false },
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
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "Organization",
                "@id": `${SITE_URL}/#org`,
                name: SITE_NAME,
                url: SITE_URL,
                logo: `${SITE_URL}/brand/app-icon-512.png`,
                parentOrganization: { "@type": "Organization", name: "Aavish AI Lab", url: "https://aavishailab.com" },
              },
              { "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: SITE_URL, name: SITE_NAME, publisher: { "@id": `${SITE_URL}/#org` }, inLanguage: "en" },
            ],
          }}
        />
        <ThemeProvider>
          <script dangerouslySetInnerHTML={{ __html: loaderGateScript }} />
          <SiteLoader />
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
