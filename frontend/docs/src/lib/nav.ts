import {
  Rocket, PlayCircle, Building2, Users, UsersRound,
  Globe, FileWarning, AppWindow, Cloud, Inbox, Camera, BarChart3, Bot,
  ShieldCheck, LifeBuoy, UserCheck, Download, Laptop, KeyRound,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: any;
  audience?: "Company" | "Employee";
};
export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    id: "getting-started",
    label: "Getting Started",
    items: [
      { href: "/getting-started/overview", label: "What is Aavishield", icon: Rocket },
      { href: "/getting-started/quick-start", label: "Quick Start", icon: PlayCircle },
    ],
  },
  {
    id: "company",
    label: "Company Admin Guide",
    items: [
      { href: "/company/organization-setup", label: "Organization Setup", icon: Building2, audience: "Company" },
      { href: "/company/team-access", label: "Team & Access (RBAC)", icon: UsersRound, audience: "Company" },
      { href: "/company/employees-devices", label: "Employees & Devices", icon: Users, audience: "Company" },
      { href: "/company/policies", label: "Policies Overview", icon: ShieldCheck, audience: "Company" },
      { href: "/company/web-security", label: "Web Security (SWG)", icon: Globe, audience: "Company" },
      { href: "/company/dlp", label: "Data Loss Prevention", icon: FileWarning, audience: "Company" },
      { href: "/company/app-cloud-control", label: "Application & Cloud Control", icon: AppWindow, audience: "Company" },
      { href: "/company/shadow-it", label: "Shadow IT Discovery", icon: Cloud, audience: "Company" },
      { href: "/company/access-requests", label: "Access Requests", icon: Inbox, audience: "Company" },
      { href: "/company/monitoring", label: "Monitoring & Screenshots", icon: Camera, audience: "Company" },
      { href: "/company/reports", label: "Activity & Reports", icon: BarChart3, audience: "Company" },
      { href: "/company/ai-assistant", label: "AI Assistant", icon: Bot, audience: "Company" },
      { href: "/company/security-mfa", label: "Security & MFA", icon: KeyRound, audience: "Company" },
      { href: "/company/support", label: "Support", icon: LifeBuoy, audience: "Company" },
    ],
  },
  {
    id: "employee",
    label: "Employee Guide",
    items: [
      { href: "/employee/activate-account", label: "Activating Your Account", icon: UserCheck, audience: "Employee" },
      { href: "/employee/install-agent", label: "Installing the Agent", icon: Download, audience: "Employee" },
      { href: "/employee/devices-activity", label: "Your Devices & Activity", icon: Laptop, audience: "Employee" },
      { href: "/employee/requesting-access", label: "Requesting Access", icon: Inbox, audience: "Employee" },
    ],
  },
];

export const allPages: NavItem[] = navGroups.flatMap((g) => g.items);

export function pageNeighbors(href: string): { prev?: NavItem; next?: NavItem } {
  const i = allPages.findIndex((p) => p.href === href);
  if (i === -1) return {};
  return { prev: allPages[i - 1], next: allPages[i + 1] };
}
