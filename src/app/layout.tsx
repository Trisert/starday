import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hubble-compleanno.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Che foto ha scattato Hubble il giorno in cui sei nato?",
  description:
    "Scopri che foto ha scattato il telescopio Hubble (o JWST) il giorno in cui sei nato. Inserisci la tua data di nascita e guarda l'immagine NASA del giorno.",
  keywords: ["hubble", "nasa", "apod", "jwst", "compleanno", "astronomia"],
  authors: [{ name: "Nicola Destro" }],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "Che foto ha scattato Hubble il giorno in cui sei nato?",
    description:
      "Inserisci la tua data di nascita e scopri l'immagine Hubble/NASA del tuo compleanno.",
    type: "website",
    locale: "it_IT",
    siteName: "Hubble Compleanno",
    url: "/",
    images: [
      {
        url: "/api/og",
        width: 1200,
        height: 630,
        alt: "Hubble Compleanno — la foto NASA del giorno in cui sei nato",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Che foto ha scattato Hubble il giorno in cui sei nato?",
    description:
      "Inserisci la tua data di nascita e scopri l'immagine Hubble/NASA del tuo compleanno.",
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
    name: "Hubble Compleanno",
    description:
      "Scopri che foto ha scattato il telescopio Hubble (o JWST) il giorno in cui sei nato.",
    url: SITE_URL,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any",
    inLanguage: "it",
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
    <html lang="it" className={`${geistSans.variable} h-full antialiased`}>
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
