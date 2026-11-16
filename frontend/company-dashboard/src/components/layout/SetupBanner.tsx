"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Rocket } from "lucide-react";
import { onboardingApi } from "@/lib/api";
import { isDemo } from "@/lib/demo";

// Self-serve companies that skipped the setup wizard get a way back to it
// until they finish. Sales-led organizations never see this.
export function SetupBanner() {
  const { data } = useQuery({
    queryKey: ["onboarding"],
    queryFn: async () => (await onboardingApi.get()).data as { self_serve: boolean; onboarded: boolean; team_trial: boolean },
    enabled: !isDemo,
    staleTime: 60_000,
  });
  if (!data?.self_serve || data.onboarded) return null;

  return (
    <div className="px-4 pt-4">
      <div className="flex items-center gap-3 rounded-lg border border-brand-500/20 bg-brand-500/10 px-4 py-3 text-sm text-foreground">
        <Rocket className="h-4 w-4 shrink-0 text-brand-500" />
        <p className="flex-1">
          {data.team_trial
            ? "Finish setting up: invite your team and install the agent on their laptops."
            : "Finish setting up: install Aavishield on your laptop, then choose a plan to add your team."}
        </p>
        <Link href="/onboarding" className="inline-flex items-center gap-1 font-medium text-brand-500 hover:underline">
          Continue setup <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
