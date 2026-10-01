import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aavishield",
    short_name: "Aavishield",
    description: "Endpoint security for every device. Secure today. Enable tomorrow.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#ff7000",
    icons: [
      { src: "/brand/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
