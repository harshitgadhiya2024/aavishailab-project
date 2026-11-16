import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { AnnouncementBanner } from "@/components/layout/AnnouncementBanner";
import { DataStoreBanner } from "@/components/layout/DataStoreBanner";
import { SetupBanner } from "@/components/layout/SetupBanner";
import { authOptions } from "@/lib/auth";
import { AssistantWidget } from "@/components/assistant/AssistantWidget";
import { WelcomeTour } from "@/components/onboarding/WelcomeTour";
import { BookDemo } from "@/components/onboarding/BookDemo";
import { isDemo } from "@/lib/demo";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!isDemo) {
    const session = await getServerSession(authOptions);
    if (!session) redirect("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header />
        <AnnouncementBanner />
        <SetupBanner />
        <DataStoreBanner />
        <main className="dash flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
      {/* The AI assistant floats over every page (bottom right). */}
      <AssistantWidget />
      {/* Welcome popup and product tour, once, after a company signs up. */}
      <WelcomeTour />
      {/* Book a demo with the team: opened from the header or the welcome popup. */}
      <BookDemo />
    </div>
  );
}
