"use client";

import { motion, useMotionTemplate, useMotionValue } from "motion/react";

/** Surface whose border and wash light up under the cursor. */
export function Spotlight({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const mx = useMotionValue(-400);
  const my = useMotionValue(-400);
  const wash = useMotionTemplate`radial-gradient(420px circle at ${mx}px ${my}px, color-mix(in oklab, var(--fg) 7%, transparent), transparent 60%)`;
  const edge = useMotionTemplate`radial-gradient(260px circle at ${mx}px ${my}px, color-mix(in oklab, var(--fg) 45%, transparent), transparent 70%)`;

  return (
    <div
      className={`group relative isolate overflow-hidden rounded-[20px] border border-line bg-surface ${className}`}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set(e.clientX - r.left);
        my.set(e.clientY - r.top);
      }}
      onPointerLeave={() => {
        mx.set(-400);
        my.set(-400);
      }}
    >
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: wash }} />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[20px] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: edge,
          padding: 1,
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
        }}
      />
      {children}
    </div>
  );
}
