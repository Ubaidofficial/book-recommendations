import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { websiteJsonLd, organizationJsonLd } from "@/lib/jsonld";
import "./globals.css";

export const metadata: Metadata = {
  title: "BookMentions | Source-Backed Book Recommendations",
  description:
    "Discover books recommended by notable people, curated lists, and reading series. We link to the original source wherever we have one.",
  alternates: { canonical: "https://bookmentions.net" },
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    title: "BookMentions | Source-Backed Book Recommendations",
    description:
      "Discover books recommended by notable people, curated lists, and reading series. We link to the original source wherever we have one.",
    url: "https://bookmentions.net",
    siteName: "BookMentions",
    type: "website",
    images: [{ url: "https://bookmentions.net/icon-512.png", width: 512, height: 512, alt: "BookMentions" }],
  },
  twitter: {
    card: "summary",
    images: ["https://bookmentions.net/icon-512.png"],
    title: "BookMentions | Source-Backed Book Recommendations",
    description:
      "Discover books recommended by notable people, curated lists, and reading series. We link to the original source wherever we have one.",
  },
};

export const viewport: Viewport = {
  themeColor: "#5b4fcf",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const websiteSchema = websiteJsonLd();
  const orgSchema = organizationJsonLd();

  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
        />
        <Script id="gtm-script" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
          new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
          j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
          'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
          })(window,document,'script','dataLayer','GTM-N8SF996L');`}
        </Script>
        {/* SourceTrack: queue stub so calls made before the tracker loads are not lost */}
        <script
          dangerouslySetInnerHTML={{
            __html: `!function(w){if(w.sourcetrack)return;var q=[],s={_q:q};"track conversion identify group reset consent optIn optOut".split(" ").forEach(function(m){s[m]=function(){q.length<100&&q.push([m,[].slice.call(arguments)])}});w.sourcetrack=s}(window);`,
          }}
        />
        <script
          async
          src="https://sourcetrack-api-staging.up.railway.app/tracker.min.js"
          data-site-key="ae77737b-5211-4cba-8da9-9da94d9d5abb"
        />
      </head>
      <body className="bg-bg text-ink antialiased min-h-screen flex flex-col">
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-N8SF996L"
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
          />
        </noscript>
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
