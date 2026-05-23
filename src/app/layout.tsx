import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "BookRecs — Discover Your Next Great Read",
  description:
    "Discover the best books recommended by the world's most respected people.",
  alternates: { canonical: "https://bookrecommendations.com" },
  openGraph: {
    title: "BookRecs — Discover Your Next Great Read",
    description:
      "Discover the best books recommended by the world's most respected people.",
    url: "https://bookrecommendations.com",
    siteName: "BookRecs",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BookRecs — Discover Your Next Great Read",
    description:
      "Discover the best books recommended by the world's most respected people.",
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
