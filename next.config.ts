import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api.nasa.gov" },
      { protocol: "https", hostname: "apod.nasa.gov" },
      { protocol: "https", hostname: "images-assets.nasa.gov" },
      { protocol: "https", hostname: "images.nasa.gov" },
      { protocol: "https", hostname: "cdn.spacetelescope.org" },
    ],
  },
};

export default nextConfig;
