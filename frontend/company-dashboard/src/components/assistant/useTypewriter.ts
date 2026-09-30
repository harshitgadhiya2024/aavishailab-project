"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reveals `target` a few characters per frame so a streamed answer reads as
 * if it were being typed, even when the model sends it in big chunks. The
 * pace scales with how far behind it is, so it never lags the stream by more
 * than a moment, and it jumps to the end when `done` or reduced motion.
 */
export function useTypewriter(target: string, active: boolean) {
  const [shown, setShown] = useState(active ? "" : target);
  const shownRef = useRef(shown);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!active || reduce) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    let raf = 0;
    const tick = () => {
      const t = targetRef.current;
      const cur = shownRef.current;
      if (!t.startsWith(cur)) {
        // The stream was reset (tool call); start over from the new text.
        shownRef.current = "";
      } else if (cur.length < t.length) {
        const backlog = t.length - cur.length;
        const step = Math.max(1, Math.ceil(backlog / 18));
        shownRef.current = t.slice(0, cur.length + step);
        setShown(shownRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target]);

  return shown;
}
