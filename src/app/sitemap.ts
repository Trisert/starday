import type { MetadataRoute } from "next";

// Override at deploy time with NEXT_PUBLIC_SITE_URL
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://hubble-compleanno.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 1.0,
    },
  ];
}
