"use client";

import {
  AppleLogo,
  LinuxLogo,
  ShieldCheck,
  Signature,
  WindowsLogo,
  type Icon,
} from "@phosphor-icons/react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useEffect, useState } from "react";
import { Float } from "./motion/float";

type Event = { id: number; label: string; detail: string; state: "blocked" | "flagged" | "allowed" };

const FEED: Omit<Event, "id">[] = [
  { label: "Upload to chatgpt.com", detail: "API key detected", state: "flagged" },
  { label: "NordVPN.app", detail: "VPN client", state: "blocked" },
  { label: "invoice_0932.zip", detail: "Trojan in download", state: "blocked" },
  { label: "docs.google.com", detail: "Productivity", state: "allowed" },
  { label: "Q3-salaries.xlsx", detail: "Sent via Outlook", state: "flagged" },
  { label: "bet365.com", detail: "Gambling category", state: "blocked" },
  { label: "figma-setup.dmg", detail: "Scanned clean", state: "allowed" },
];

const STATE_STYLE: Record<Event["state"], string> = {
  blocked: "text-danger",
  flagged: "text-fg",
  allowed: "text-signal",
};

function useParallax(depth: number, mx: MotionValue<number>, my: MotionValue<number>) {
  return {
    x: useTransform(mx, (v) => v * depth),
    y: useTransform(my, (v) => v * depth),
  };
}

function DeviceChip({ icon: I, name, user }: { icon: Icon; name: string; user: string }) {
  return (
    <div className="glass flex items-center gap-3 rounded-full py-2 pl-2 pr-4">
      <span className="grid size-8 place-items-center rounded-full bg-invert-bg text-invert-fg">
        <I size={16} weight="fill" />
      </span>
      <span className="leading-tight">
        <span className="block text-[13px] font-medium text-fg">{name}</span>
        <span className="block text-[11px] text-muted">{user}</span>
      </span>
      <span className="ml-1 flex items-center gap-1.5 text-[11px] font-medium text-signal">
        <span className="relative flex size-1.5">
          <span className="absolute inset-0 animate-pulse-ring rounded-full bg-signal" />
          <span className="relative size-1.5 rounded-full bg-signal" />
        </span>
        Protected
      </span>
    </div>
  );
}

export function HeroField() {
  const reduce = useReducedMotion();
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const mx = useSpring(rawX, { stiffness: 60, damping: 18 });
  const my = useSpring(rawY, { stiffness: 60, damping: 18 });

  const far = useParallax(-8, mx, my);
  const mid = useParallax(14, mx, my);
  const near = useParallax(26, mx, my);

  const [events, setEvents] = useState<Event[]>(() => FEED.slice(0, 3).map((e, i) => ({ ...e, id: i })));

  useEffect(() => {
    if (reduce) return;
    let n = 3;
    const t = setInterval(() => {
      const next = { ...FEED[n % FEED.length], id: n };
      n += 1;
      setEvents((prev) => [next, ...prev].slice(0, 3));
    }, 2400);
    return () => clearInterval(t);
  }, [reduce]);

  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-[560px] select-none"
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        rawX.set((e.clientX - r.left) / r.width - 0.5);
        rawY.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onPointerLeave={() => {
        rawX.set(0);
        rawY.set(0);
      }}
      aria-hidden
    >
      {/* Orbits */}
      <motion.div style={far} className="absolute inset-0">
        <svg viewBox="0 0 560 560" className="size-full">
          {[250, 190, 130].map((r, i) => (
            <circle key={r} cx="280" cy="280" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="1" strokeDasharray={i === 1 ? "2 6" : undefined} />
          ))}
        </svg>
        <motion.div
          className="absolute inset-[45px]"
          animate={reduce ? undefined : { rotate: 360 }}
          transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
        >
          <span className="absolute left-1/2 top-0 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg" />
        </motion.div>
        <motion.div
          className="absolute inset-[150px]"
          animate={reduce ? undefined : { rotate: -360 }}
          transition={{ duration: 36, repeat: Infinity, ease: "linear" }}
        >
          <span className="absolute bottom-0 left-1/2 size-1.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-fg/60" />
        </motion.div>
      </motion.div>

      {/* Core */}
      <motion.div style={mid} className="absolute inset-0 grid place-items-center">
        <div className="relative grid size-32 place-items-center">
          <span className="absolute inset-0 animate-pulse-ring rounded-full border border-fg/30" />
          <span className="absolute inset-0 animate-pulse-ring rounded-full border border-fg/20 [animation-delay:1.2s]" />
          <motion.div
            initial={reduce ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 140, damping: 16, delay: 0.3 }}
            className="relative grid size-24 place-items-center rounded-full bg-invert-bg text-invert-fg shadow-[0_30px_80px_-20px_rgb(0_0_0/0.5)]"
          >
            <ShieldCheck size={40} weight="light" />
            <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
              <span className="absolute inset-x-0 top-0 h-3 animate-scan bg-gradient-to-b from-transparent via-invert-fg/25 to-transparent" />
            </span>
          </motion.div>
        </div>
      </motion.div>

      {/* Devices */}
      <motion.div style={near} className="absolute inset-0">
        <Float className="absolute left-[2%] top-[14%]" amplitude={9} duration={6.5}>
          <DeviceChip icon={AppleLogo} name="MacBook Pro" user="Ananya Iyer" />
        </Float>
        <Float className="absolute right-[0%] top-[40%]" amplitude={12} duration={7.5} delay={0.8}>
          <DeviceChip icon={WindowsLogo} name="ThinkPad X1" user="Rohan Mehta" />
        </Float>
        <Float className="absolute bottom-[22%] left-[8%]" amplitude={8} duration={5.8} delay={1.6}>
          <DeviceChip icon={LinuxLogo} name="build-02" user="Engineering" />
        </Float>
      </motion.div>

      {/* Signed policy card */}
      <motion.div style={mid} className="absolute right-[4%] top-[3%]">
        <Float amplitude={6} duration={8} rotate={1.5}>
          <div className="glass flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5">
            <Signature size={18} weight="light" className="text-fg" />
            <span className="leading-tight">
              <span className="block text-[12px] font-medium text-fg">Policy bundle signed</span>
              <span className="block font-mono text-[10.5px] text-muted">Ed25519 verified on device</span>
            </span>
          </div>
        </Float>
      </motion.div>

      {/* Live feed */}
      <motion.div style={near} className="absolute -bottom-2 right-[2%] w-[270px]">
        <div className="glass rounded-[20px] p-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[12px] font-medium text-fg">Live enforcement</span>
            <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-signal">
              <span className="size-1.5 rounded-full bg-signal" />
              streaming
            </span>
          </div>
          <ul className="relative grid gap-1.5">
            <AnimatePresence initial={false} mode="popLayout">
              {events.map((e) => (
                <motion.li
                  key={e.id}
                  layout
                  initial={{ opacity: 0, y: -14, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
                  transition={{ type: "spring", stiffness: 320, damping: 30 }}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2"
                >
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate text-[12px] font-medium text-fg">{e.label}</span>
                    <span className="block truncate text-[11px] text-muted">{e.detail}</span>
                  </span>
                  <span className={`shrink-0 font-mono text-[10.5px] uppercase ${STATE_STYLE[e.state]}`}>{e.state}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      </motion.div>
    </div>
  );
}
