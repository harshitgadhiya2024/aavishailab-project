import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DelSecure",
    short_name: "DelSecure",
    description: "Endpoint security for every device.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#ff7000",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
