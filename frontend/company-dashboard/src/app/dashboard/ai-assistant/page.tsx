"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The assistant now lives in the floating chat (bottom right of every page).
 * Old links and bookmarks land here: open it and go to the dashboard.
 */
export default function AIAssistantRedirect() {
  const router = useRouter();
  useEffect(() => {
    try { sessionStorage.setItem("delsecure-open-assistant", "1"); } catch {}
    window.dispatchEvent(new CustomEvent("delsecure:open-assistant"));
    router.replace("/dashboard");
  }, [router]);
  return null;
}
