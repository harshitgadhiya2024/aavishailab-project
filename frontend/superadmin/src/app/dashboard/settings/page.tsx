"use client";

import { Settings, Globe, Bell, Shield, Database } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">Platform-level configuration</p>
      </div>

      {[
        {
          icon: Globe,
          title: "General",
          description: "Platform name, timezone, and regional settings",
        },
        {
          icon: Bell,
          title: "Notifications",
          description: "Alert thresholds, email digests, and webhook integrations",
        },
        {
          icon: Shield,
          title: "Security Policy",
          description: "Global default policies applied across all organizations",
        },
        {
          icon: Database,
          title: "Data Retention",
          description: "Configure how long activity logs and audit trails are stored",
        },
      ].map((s) => (
        <div key={s.title} className="bg-card rounded-xl border border-border shadow-sm p-5 flex items-start gap-4">
          <div className="w-10 h-10 bg-brand-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
            <s.icon className="w-5 h-5 text-brand-500" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-foreground">{s.title}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{s.description}</p>
          </div>
          <span className="text-xs bg-muted text-muted-foreground px-2.5 py-1 rounded-full">Coming soon</span>
        </div>
      ))}
    </div>
  );
}
