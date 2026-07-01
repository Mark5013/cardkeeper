import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.pokemontcg.io",
        port: "",
        pathname: "/**",
        search: "",
      },
      {
        protocol: "https",
        hostname: "images.scrydex.com",
        port: "",
        pathname: "/pokemon/**",
        search: "",
      },
    ],
  },
};

export default nextConfig;
