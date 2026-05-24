import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "BookRecs | Source-Backed Book Recommendations",
  description:
    "Discover books recommended by notable people, curated lists, and reading series. Every recommendation is connected to source-backed evidence.",
  alternates: { canonical: "https://bookrecommendations.com" },
  openGraph: {
    title: "BookRecs | Source-Backed Book Recommendations",
    description:
      "Discover books recommended by notable people, curated lists, and reading series. Every recommendation is connected to source-backed evidence.",
    url: "https://bookrecommendations.com",
    siteName: "BookRecs",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BookRecs | Source-Backed Book Recommendations",
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
