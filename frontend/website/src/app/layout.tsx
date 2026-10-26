import type { Metadata, Viewport } from "next";
import { DM_Mono, Inter, Sora } from "next/font/google";
import { Footer } from "@/components/footer";
import { Nav } from "@/components/nav";
import { SiteChrome } from "@/components/site-chrome";
import { SiteLoader, loaderGateScript } from "@/components/site-loader";
import { ThemeProvider } from "@/components/theme-provider";
import { JsonLd, SITE_NAME, SITE_URL } from "@/lib/seo";
import "./globals.css";

// Type system: Satoshi for display (Fontshare, loaded in <head>), Inter for
// body copy, DM Mono for labels. Sora SemiBold is only the logo's wordmark.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const dmMono = DM_Mono({ variable: "--font-dm-mono", subsets: ["latin"], weight: ["400", "500"] });
const sora = Sora({ variable: "--font-sora", subsets: ["latin"], weight: ["600"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Endpoint Security and DLP for Every Laptop | Aavishield",
    template: "%s | Aavishield",
  },
  description:
    "Endpoint security for companies: one agent enforces web filtering, DLP, app and VPN control, malware scanning and device posture on macOS, Windows and Linux.",
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
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${dmMono.variable} ${sora.variable} antialiased`}>
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="" />
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap" />
      </head>
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
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[6px] focus:bg-invert-bg focus:px-4 focus:py-2 focus:text-invert-fg">
            Skip to content
          </a>
          <SiteChrome nav={<Nav />} footer={<Footer />}>
            {children}
          </SiteChrome>
          <div aria-hidden className="grain pointer-events-none fixed inset-0 z-50" />
        </ThemeProvider>
      </body>
    </html>
  );
}
