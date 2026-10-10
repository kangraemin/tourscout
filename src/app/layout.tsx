import type { Metadata } from "next";
import { Archivo, Public_Sans } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const display = Archivo({ variable: "--font-display", subsets: ["latin"], axes: ["wdth"] });
const body = Public_Sans({ variable: "--font-body", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TourScout",
  description: "Find the cities where your fans already are. A routing agent for independent artists, built on Qloo's taste graph.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} antialiased`}>{children}</body>
    </html>
  );
}
