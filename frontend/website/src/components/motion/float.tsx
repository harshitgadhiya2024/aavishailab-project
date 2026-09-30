"use client";

import { motion, useReducedMotion } from "motion/react";

/** Slow perpetual bob. Used only on decorative hero objects. */
export function Float({
  children,
  className,
  amplitude = 10,
  duration = 6,
  delay = 0,
  rotate = 0,
}: {
  children: React.ReactNode;
  className?: string;
  amplitude?: number;
  duration?: number;
  delay?: number;
  rotate?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      animate={{ y: [0, -amplitude, 0], rotate: [0, rotate, 0] }}
      transition={{ duration, delay, repeat: Infinity, ease: "easeInOut" }}
    >
      {children}
    </motion.div>
  );
}
