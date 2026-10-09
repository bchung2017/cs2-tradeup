import type { MetadataRoute } from "next";

// Makes the site installable as an app (Android "Install app" / "Add to Home
// screen"): opens full-screen from its own icon, no browser bar.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CS2 Journeyman",
    short_name: "Journeyman",
    description: "Trade-up contracts checked against live prices.",
    start_url: "/venture/market",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["utilities", "finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Simulator", url: "/simulator", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Inventory", url: "/inventory", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Venture", url: "/venture/market", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
