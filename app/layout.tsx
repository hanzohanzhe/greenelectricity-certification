import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GreenProof",
  description: "Evidence for locally matched rooftop electricity.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "GreenProof · Local energy evidence",
    description: "One roof. Two tenants. Every watt-hour accounted for.",
    images: [{ url: "/og-greenproof.png", width: 1733, height: 908, alt: "GreenProof shared-rooftop energy flow" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
