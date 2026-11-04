import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Fraunces, Inter } from "next/font/google";
import SiteHeader from "@/components/layout/SiteHeader";
import SiteFooter from "@/components/layout/SiteFooter";
import BottomNav from "@/components/layout/BottomNav";
import AdSenseLoader from "@/components/ads/AdSenseLoader";
import { ADSENSE_CLIENT } from "@/lib/ads";
import NewsletterSignup from "@/components/ui/NewsletterSignup";
import "./globals.css";

// Fonts are exposed only as CSS variables; globals.css maps them to font-display and font-sans
const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-fraunces",
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

// Revalidate every hour for ISR
export const revalidate = 3600;

export const metadata: Metadata = {
  // Pages set their title through buildMetadata (src/lib/seo/metadata.ts) without the brand;
  // the template adds it. Keep TITLE_SUFFIX in sync with this template.
  title: {
    default: "Maryland Brewery: Every Craft Brewery in Maryland",
    template: "%s | Maryland Brewery",
  },
  description: "Discover the best craft breweries across Maryland. Find local breweries, events, and more. Your complete guide to Maryland's thriving craft beer scene.",
  keywords: [
    "Maryland breweries",
    "craft beer Maryland", 
    "Maryland brewery directory",
    "breweries near me",
    "craft beer Baltimore",
    "Maryland beer",
    "brewery tours Maryland",
    "craft breweries Maryland"
  ],
  authors: [{ name: "Maryland Brewery Directory" }],
  creator: "Maryland Brewery Directory",
  publisher: "Maryland Brewery Directory",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  // No canonical here: every page that inherits it would claim to be the homepage
  metadataBase: new URL("https://www.marylandbrewery.com"),
  // No openGraph.url or title here either: pages without their own would all claim the homepage.
  // buildMetadata sets them per page.
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Maryland Brewery",
  },
  twitter: {
    card: "summary_large_image",
    creator: "@marylandbrewery",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  // Search Console HTML-tag verification; set GOOGLE_SITE_VERIFICATION in Vercel
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
  // AdSense site verification by meta tag (the ad script itself loads late: AdSenseLoader)
  other: { "google-adsense-account": ADSENSE_CLIENT },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover", // Support for notched devices (iPhone X and later)
  themeColor: "#FFFDF7", // paper
};

// WebSite schema. No SearchAction: Google retired the sitelinks search box (Nov 2024) and
// /map does not read ?search=
const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Maryland Brewery',
  url: 'https://www.marylandbrewery.com',
  description: 'Every craft brewery in Maryland',
};

// Organization schema for brand recognition
const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Maryland Brewery',
  url: 'https://www.marylandbrewery.com',
  logo: 'https://www.marylandbrewery.com/icon-512.png',
  sameAs: [
    'https://twitter.com/marylandbrewery'
  ]
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`motion-safe:scroll-smooth ${fraunces.variable} ${inter.variable}`}>
      <head>
        {/* WebSite Schema for Sitelinks Search Box */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(websiteSchema),
          }}
        />
        {/* Organization Schema */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationSchema),
          }}
        />
        {/* Google Analytics 4 */}
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-KRN6QNRSFX"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'G-KRN6QNRSFX');
            `,
          }}
        />
        {/* Ahrefs Analytics */}
        <script src="https://analytics.ahrefs.com/analytics.js" data-key="feHAts9QQBm4W+I9itRXzg" async></script>
        {/* Favicons handled by Next.js from /src/app/icon.png, favicon.ico, apple-icon.png */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="msapplication-TileColor" content="#141414" />
      </head>
      <body className="flex min-h-screen flex-col bg-paper font-sans text-ink antialiased">
        <SiteHeader />
        <main id="main" className="flex min-h-0 flex-1 flex-col">
          {children}
        </main>
        <NewsletterSignup />
        <SiteFooter />
        {/* Room for the phone tab bar so it never covers the footer */}
        <div aria-hidden="true" className="h-[calc(64px+env(safe-area-inset-bottom))] bg-ink md:hidden" />
        <BottomNav />
        <AdSenseLoader />
        {process.env.NODE_ENV === 'production' && <Analytics />}
        {process.env.NODE_ENV === 'production' && <SpeedInsights />}
      </body>
    </html>
  );
}
