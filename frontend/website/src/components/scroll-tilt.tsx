"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";

/** Hero product shot that starts tilted back and straightens as it scrolls into view. */
export function ScrollTilt({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [18, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], reduce ? [1, 1] : [0.92, 1]);
  const y = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [40, 0]);
  return (
    <div ref={ref} className={className} style={{ perspective: 1600 }}>
      <motion.div style={{ rotateX, scale, y, transformOrigin: "center top" }}>{children}</motion.div>
    </div>
  );
}
