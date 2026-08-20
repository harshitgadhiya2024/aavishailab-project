"use client";

import { useSession } from "next-auth/react";

/**
 * Permission constants — must match models/permissions.go. The API enforces
 * these; the UI uses them only to avoid showing a control that would 403.
 */
export const PERMISSIONS = {
  employeesRead: "employees:read",
  employeesWrite: "employees:write",
  teamsRead: "teams:read",
  teamsWrite: "teams:write",
  policiesRead: "policies:read",
  policiesWrite: "policies:write",
  activityRead: "activity:read",
  reportsRead: "reports:read",
  devicesRead: "devices:read",
  devicesWrite: "devices:write",
  swgRead: "swg:read",
  swgWrite: "swg:write",
  shadowItRead: "shadow_it:read",
  shadowItWrite: "shadow_it:write",
  casbRead: "casb:read",
  casbWrite: "casb:write",
  categoriesRead: "categories:read",
  categoriesWrite: "categories:write",
  settingsRead: "settings:read",
  settingsWrite: "settings:write",
  accessRequestsRead: "access_requests:read",
  accessRequestsWrite: "access_requests:write",
  usersRead: "users:read",
  usersWrite: "users:write",
  aiUse: "ai:use",
  monitoringRead: "monitoring:read",
  monitoringDeleteSession: "monitoring:delete_session",
  monitoringDeleteScreenshot: "monitoring:delete_screenshot",
} as const;

export const ROLE_LABELS: Record<string, string> = {
  org_admin: "Administrator",
  manager: "Team manager",
  analyst: "Security analyst",
  read_only: "Read only",
  superadmin: "Platform admin",
};

export function usePermissions() {
  const { data: session, status } = useSession();
  const user = (session as any)?.user;
  const permissions: string[] = user?.permissions ?? [];
  const role: string = user?.role ?? "";

  // While the session loads, treat everything as permitted rather than
  // flashing a stripped-down UI that then fills in — the API is the real gate.
  const loading = status === "loading";

  const can = (permission: string) => loading || permissions.includes(permission);
  const canAny = (...perms: string[]) => loading || perms.some(p => permissions.includes(p));

  return {
    role,
    roleLabel: ROLE_LABELS[role] ?? role,
    permissions,
    teamIds: (user?.team_ids ?? []) as string[],
    loading,
    can,
    canAny,
    isAdmin: role === "org_admin" || role === "superadmin",
    /** A manager scoped to specific teams sees only those teams' people. */
    isTeamScoped: role === "manager" && (user?.team_ids ?? []).length > 0,
  };
}
