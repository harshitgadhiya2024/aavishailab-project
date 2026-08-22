import Link from "next/link";
import {
  Shield, ArrowRight, Building2, UserCheck, Rocket, Globe, FileWarning,
  AppWindow, Bot, Camera, BarChart3, KeyRound, Download, Laptop, Inbox,
} from "lucide-react";

const QUICK_LINKS = [
  { href: "/getting-started/quick-start", icon: Rocket, title: "Quick Start", desc: "Sign up, set up your org, and get your first policy live." },
  { href: "/company/organization-setup", icon: Building2, title: "Company Admin Guide", desc: "Everything an org admin can configure and manage." },
  { href: "/employee/activate-account", icon: UserCheck, title: "Employee Guide", desc: "Activating your account and installing the agent." },
];

const FEATURE_ICONS = [
  { icon: Globe, label: "Web Gateway" },
  { icon: FileWarning, label: "DLP" },
  { icon: AppWindow, label: "App Control" },
  { icon: Bot, label: "AI Assistant" },
  { icon: Camera, label: "Monitoring" },
  { icon: BarChart3, label: "Reports" },
  { icon: KeyRound, label: "MFA" },
  { icon: Download, label: "Agent" },
  { icon: Laptop, label: "Devices" },
  { icon: Inbox, label: "Access Requests" },
];

export default function HomePage() {
  return (
    <div className="max-w-5xl mx-auto px-8 py-16 lg:px-12">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 bg-brand-500 rounded-xl flex items-center justify-center">
          <Shield className="w-6 h-6 text-[#0A0A0A]" />
        </div>
        <span className="text-sm font-medium text-muted-foreground">Aavishield Documentation</span>
      </div>

      <h1 className="text-4xl font-bold text-foreground tracking-tight max-w-2xl">
        Everything you need to run Aavishield for your company.
      </h1>
      <p className="text-lg text-muted-foreground mt-4 max-w-2xl leading-relaxed">
        From your first sign-up to every policy, control, and report inside the platform — for company admins and for employees.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-10">
        {QUICK_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="group bg-card border border-border rounded-xl p-5 hover:border-brand-500/40 transition-colors"
          >
            <div className="w-9 h-9 bg-brand-500/10 rounded-lg flex items-center justify-center mb-3">
              <l.icon className="w-4.5 h-4.5 text-brand-500" />
            </div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              {l.title}
              <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
            </h3>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{l.desc}</p>
          </Link>
        ))}
      </div>

      <div className="mt-16">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-5">What's covered</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {FEATURE_ICONS.map((f) => (
            <div key={f.label} className="flex flex-col items-center text-center gap-2 py-4">
              <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
                <f.icon className="w-4.5 h-4.5 text-muted-foreground" />
              </div>
              <span className="text-xs text-muted-foreground">{f.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
