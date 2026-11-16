import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDemo } from "@/lib/demo";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  if (!isDemo) {
    const session = await getServerSession(authOptions);
    if (!session) redirect("/login");
  }
  return children;
}
