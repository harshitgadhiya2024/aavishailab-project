"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import Image from "next/image";
import { useRef } from "react";

/**
 * Rounded image that drifts slightly slower than the page and unveils
 * (clip + scale settle) the first time it enters view.
 */
export function ParallaxImage({
  src,
  alt,
  sizes,
  className = "",
  aspect = "aspect-[16/9]",
  eager = false,
  strength = 60,
  children,
}: {
  src: string;
  alt: string;
  sizes: string;
  className?: string;
  aspect?: string;
  eager?: boolean;
  strength?: number;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [-strength, strength]);

  return (
    <motion.div
      ref={ref}
      initial={reduce ? false : { clipPath: "inset(8% 8% 8% 8% round 28px)", opacity: 0.4 }}
      whileInView={{ clipPath: "inset(0% 0% 0% 0% round 28px)", opacity: 1 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      className={`relative overflow-hidden rounded-[28px] bg-ink ${aspect} ${className}`}
    >
      <motion.div style={{ y }} className="absolute -inset-y-[12%] inset-x-0">
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          className="object-cover"
          // eager = this image is the page's LCP: preload it from <head>.
          {...(eager ? { preload: true } : { loading: "lazy" as const })}
        />
      </motion.div>
      {children}
    </motion.div>
  );
}
