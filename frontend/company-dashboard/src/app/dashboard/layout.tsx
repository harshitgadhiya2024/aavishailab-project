import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { AnnouncementBanner } from "@/components/layout/AnnouncementBanner";
import { DataStoreBanner } from "@/components/layout/DataStoreBanner";
import { authOptions } from "@/lib/auth";
import { AssistantWidget } from "@/components/assistant/AssistantWidget";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header />
        <AnnouncementBanner />
        <DataStoreBanner />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
      {/* The AI assistant floats over every page (bottom right). */}
      <AssistantWidget />
    </div>
  );
}
