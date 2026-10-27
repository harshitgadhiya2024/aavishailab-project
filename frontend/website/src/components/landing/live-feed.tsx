"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { LiveDot, StatePill, type EventState } from "./visuals";

export type LiveFeedItem = { label: string; detail: string; control: string; state: EventState };

// Same fictional demo data as the console screenshots.
const FEED: LiveFeedItem[] = [
  { label: "bet365.com", detail: "Gambling category", control: "Web", state: "blocked" },
  { label: "Q3-salaries.xlsx → chatgpt.com", detail: "Salary data, PAN × 12", control: "DLP", state: "flagged" },
  { label: "NordVPN.app", detail: "VPN client", control: "VPN", state: "blocked" },
  { label: "docs.google.com", detail: "Productivity", control: "Web", state: "allowed" },
  { label: "invoice_0932.zip", detail: "Trojan in download", control: "Malware", state: "blocked" },
  { label: "prod.env in Teams", detail: "API key detected", control: "DLP", state: "flagged" },
  { label: "AnyDesk", detail: "Remote access tool", control: "Apps", state: "blocked" },
  { label: "ThinkPad · Rohan", detail: "Firewall turned off", control: "Posture", state: "flagged" },
];
const VISIBLE = 4;

/** The hero's "live decisions" panel: a new event slides in every few seconds. */
export function LiveFeed({
  className = "",
  items = FEED,
  scope = "All devices",
}: {
  className?: string;
  items?: LiveFeedItem[];
  scope?: string;
}) {
  const reduce = useReducedMotion();
  const [head, setHead] = useState(0);
  const feed = items.length ? items : FEED;

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setHead((h) => h + 1), 2400);
    return () => clearInterval(id);
  }, [reduce]);

  const rows = Array.from({ length: VISIBLE }, (_, i) => {
    const n = head - i;
    return { key: n, item: feed[((n % feed.length) + feed.length) % feed.length] };
  });

  return (
    <div className={`overflow-hidden rounded-[6px] border border-line-strong/70 bg-surface/95 shadow-[0_30px_60px_-30px_rgb(120_50_0/0.45)] backdrop-blur ${className}`}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-fg">
          <LiveDot /> Live decisions
        </span>
        <span className="max-w-[46%] truncate text-right font-mono text-[10px] text-muted">{scope}</span>
      </div>
      <ul className="relative h-[232px]">
        <AnimatePresence initial={false}>
          {rows.map(({ key, item }, i) => (
            <motion.li
              key={key}
              layout
              initial={{ opacity: 0, y: -24 }}
              animate={{ opacity: 1 - i * 0.12, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
              className="flex h-[58px] items-center gap-3 border-b border-line px-4"
            >
              <span className="w-14 shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] text-muted">{item.control}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-fg">{item.label}</span>
                <span className="block truncate text-[11.5px] text-muted">{item.detail}</span>
              </span>
              <StatePill state={item.state} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
