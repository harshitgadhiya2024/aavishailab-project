import { GridButton } from "./landing/grid-button";

type Props = {
  href: string;
  children: React.ReactNode;
  variant?: "solid" | "ghost";
  size?: "md" | "lg";
  className?: string;
};

/** The site's link-button: the landing page's squared mono button, in two heights. */
export function Button({ href, children, variant = "solid", size = "md", className = "" }: Props) {
  return (
    <GridButton href={href} variant={variant} className={`${size === "lg" ? "h-11 px-5" : ""} ${className}`}>
      {children}
    </GridButton>
  );
}
