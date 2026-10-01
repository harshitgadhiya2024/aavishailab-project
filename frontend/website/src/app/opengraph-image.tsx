import { ogCard, ogSize } from "@/lib/og";

export const alt = "Aavishield: endpoint security for every device";
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogCard({ eyebrow: "Endpoint security for modern companies", title: "Security that travels with every laptop." });
}
