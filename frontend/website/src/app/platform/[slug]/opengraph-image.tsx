import { getModule, modules } from "@/lib/content";
import { ogCard, ogSize } from "@/lib/og";

export const alt = "Aavishield feature";
export const size = ogSize;
export const contentType = "image/png";

export function generateStaticParams() {
  return modules.map((m) => ({ slug: m.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const m = getModule((await params).slug)!;
  return ogCard({ eyebrow: `Aavishield ${m.name}`, title: m.headline });
}
