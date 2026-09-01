import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Che foto ha scattato Hubble il giorno in cui sei nato?",
  description:
    "Scopri che foto ha scattato il telescopio Hubble (o JWST) il giorno in cui sei nato. Inserisci la tua data di nascita e guarda l'immagine NASA del giorno.",
  openGraph: {
    title: "Che foto ha scattato Hubble il giorno in cui sei nato?",
    description:
      "Inserisci la tua data di nascita e scopri l'immagine Hubble/NASA del tuo compleanno.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full bg-zinc-950 text-zinc-100 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
