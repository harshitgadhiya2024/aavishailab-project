import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";

const SECTIONS = [
  {
    title: "1. Information we collect",
    body: "We collect your account information (name, work email) and the device/activity data your employer's administrator has configured Aavishield to monitor for security policy enforcement.",
  },
  {
    title: "2. How we use your information",
    body: "Information is used to authenticate your account and enforce your company's security policies on the devices you enroll. Only your organization's authorized administrators can see your activity data.",
  },
  {
    title: "3. Data sharing",
    body: "We do not sell your data, and it is never shared with other organizations on the platform.",
  },
  {
    title: "4. Data retention",
    body: "Your data is retained for as long as your employer maintains an active Aavishield subscription, plus a limited period afterward as required for legal and audit purposes.",
  },
  {
    title: "5. Your rights",
    body: "You may request access to, correction of, or deletion of your personal data by contacting your IT administrator or Aavishield support.",
  },
  {
    title: "6. Contact",
    body: "Questions about this policy can be directed to your IT administrator or to Aavishield support.",
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandLogo className="h-12" priority />
          </div>
          <Link href="/login" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-foreground mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: 2026</p>

        <div className="space-y-8">
          {SECTIONS.map(s => (
            <section key={s.title}>
              <h2 className="text-lg font-semibold text-foreground mb-2">{s.title}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
