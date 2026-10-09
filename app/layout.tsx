import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TradeupProvider } from "@/lib/tradeup-context";
import TopRail from "@/components/TopRail";
import CircuitBoard from "@/components/CircuitBoard";
import VentureToast from "@/components/VentureToast";
import RegisterSW from "@/components/RegisterSW";

export const metadata: Metadata = {
  title: "CS2 Journeyman · Trade-Up Console",
  description: "Single trade-up analysis. Probability, float, average payout.",
  applicationName: "Journeyman",
  appleWebApp: { capable: true, title: "Journeyman", statusBarStyle: "black" },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

// Explicit viewport so the layout scales to the device width on mobile (the
// page uses a custom <head>, so we set this rather than rely on the default).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Colors the Android status bar and task switcher to match the app.
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Shared background behind every surface; lives in the layout so it
            never remounts on navigation. */}
        <CircuitBoard />
        <TradeupProvider>
          <TopRail />
          {children}
          <VentureToast />
        </TradeupProvider>
        <RegisterSW />
      </body>
    </html>
  );
}
