import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BookMentions | Source-Backed Book Recommendations",
    short_name: "BookMentions",
    description:
      "Discover books recommended by notable people, curated lists, and reading series.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf9f7",
    theme_color: "#5b4fcf",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
