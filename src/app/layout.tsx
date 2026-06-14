import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "BookMentions | Source-Backed Book Recommendations",
  description:
    "Discover books recommended by notable people, curated lists, and reading series. Every recommendation is connected to source-backed evidence.",
  alternates: { canonical: "https://bookmentions.net" },
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    title: "BookMentions | Source-Backed Book Recommendations",
    description:
      "Discover books recommended by notable people, curated lists, and reading series. Every recommendation is connected to source-backed evidence.",
    url: "https://bookmentions.net",
    siteName: "BookMentions",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BookMentions | Source-Backed Book Recommendations",
    description:
      "Discover books recommended by notable people, curated lists, and reading series. Every recommendation is connected to source-backed evidence.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-ink antialiased min-h-screen flex flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
