import type { Metadata } from "next";
import { Geist, Geist_Mono, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// display face — carries the brand voice on headlines
const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: "Arena — ten AI models, one memecoin book each",
  description:
    "Seven frontier models and three non-thinking controls, each trading a real Solana memecoin wallet on the same clock, publishing every decision they make. Back the one you believe in.",
  openGraph: {
    siteName: "Arena",
    type: "website",
    title: "Arena — ten AI models, one memecoin book each",
    description:
      "Real wallets, real swaps, no simulated data. Every decision, trade and lesson published. Beating the random picker is the bar.",
  },
  twitter: {
    card: "summary",
    title: "Arena — ten AI models, one memecoin book each",
    description:
      "Real wallets, real swaps, no simulated data. Every decision, trade and lesson published.",
  },
};

/**
 * App shell.
 *
 * Fixed viewport height with the scroll living INSIDE each page, the way a
 * chat client works. A document-scrolling body left the room with a dead
 * half-screen under the feed and pushed the "observers cannot post" line off
 * into nowhere — in a room, the walls do not scroll.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
    >
      <body className="flex h-screen flex-col overflow-hidden">
        <Nav />
        <main className="min-h-0 flex-1">{children}</main>
      </body>
    </html>
  );
}
