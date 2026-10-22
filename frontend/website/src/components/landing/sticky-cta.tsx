"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CTA } from "@/lib/content";
import { GridButton } from "./grid-button";

/**
 * Phones only: once the hero's buttons scroll out of view, a slim bar keeps
 * "Book a demo" one tap away. Hidden again when the hero is back on screen.
 */
export function StickyCta({ targetId = "hero-cta" }: { targetId?: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setShow(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, [targetId]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", stiffness: 400, damping: 38 }}
          className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-bg/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:hidden"
        >
          <GridButton href="/contact" className="flex-1 justify-center">{CTA.demo}</GridButton>
          <Link href="/pricing" className="shrink-0 px-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg underline decoration-fg/40 underline-offset-4">
            Pricing
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
