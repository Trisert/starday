import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://starday.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "StarDay — What photo did Hubble take on the day you were born?",
  description:
    "Discover the Hubble (or JWST) photo from your birthday. Enter your birthdate and see the NASA image of the day.",
  keywords: ["starday", "hubble", "nasa", "apod", "jwst", "birthday", "astronomy"],
  authors: [{ name: "Nicola Destro" }],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "StarDay — What photo did Hubble take on your birthday?",
    description:
      "Enter your birthdate and discover the Hubble/NASA image of your birthday.",
    type: "website",
    locale: "en_US",
    siteName: "StarDay",
    url: "/",
    images: [
      {
        url: "/api/og",
        width: 1200,
        height: 630,
        alt: "StarDay — the NASA photo from the day you were born",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "StarDay — What photo did Hubble take on your birthday?",
    description:
      "Enter your birthdate and discover the Hubble/NASA image of your birthday.",
    images: ["/api/og"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "StarDay",
    description:
      "Discover the Hubble (or JWST) photo from the day you were born.",
    url: SITE_URL,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any",
    inLanguage: "en",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "EUR",
    },
    author: {
      "@type": "Person",
      name: "Nicola Destro",
    },
    provider: {
      "@type": "Organization",
      name: "NASA",
      url: "https://api.nasa.gov",
    },
  };

  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full bg-zinc-950 text-zinc-100 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
