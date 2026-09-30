import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

type Props = {
  href: string;
  children: React.ReactNode;
  variant?: "solid" | "ghost";
  size?: "md" | "lg";
  className?: string;
};

/** Pill link-button. Solid = brand orange (near-black text, as in the product), ghost = hairline outline. */
export function Button({ href, children, variant = "solid", size = "md", className = "" }: Props) {
  const external = href.startsWith("http");
  const Arrow = external ? ArrowUpRight : ArrowRight;
  const base =
    "group/btn relative inline-flex items-center gap-2 whitespace-nowrap rounded-full font-medium transition-[transform,background-color,color,border-color] duration-200 ease-out-expo active:scale-[0.97]";
  const sizes = size === "lg" ? "h-12 pl-6 pr-5 text-[15px]" : "h-10 pl-5 pr-4 text-sm";
  const variants =
    variant === "solid"
      ? "bg-brand text-on-brand shadow-[0_8px_24px_-10px_rgb(255_112_0/0.7)] hover:bg-brand-dark"
      : "border border-line-strong text-fg hover:bg-bg-2";
  return (
    <Link href={href} className={`${base} ${sizes} ${variants} ${className}`}>
      {children}
      <span className="relative grid size-4 place-items-center overflow-hidden">
        <Arrow size={15} weight="bold" className="transition-transform duration-300 ease-out-expo group-hover/btn:translate-x-4" />
        <Arrow size={15} weight="bold" className="absolute -translate-x-4 transition-transform duration-300 ease-out-expo group-hover/btn:translate-x-0" />
      </span>
    </Link>
  );
}
