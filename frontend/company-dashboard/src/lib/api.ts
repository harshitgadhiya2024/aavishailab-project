import axios, { AxiosInstance, AxiosError } from "axios";
import { getSession, signOut } from "next-auth/react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:6000";
const AI_URL = process.env.NEXT_PUBLIC_AI_URL || "http://localhost:6002";

export function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: API_URL,
    headers: { "Content-Type": "application/json" },
    timeout: 30000,
  });

  client.interceptors.request.use(async (config) => {
    if (!config.headers.Authorization) {
      const session = await getSession();
      const token = (session as any)?.accessToken;
      if (token) config.headers.Authorization = `Bearer ${token}`;
      const orgId = (session as any)?.user?.org_id;
      if (orgId) config.headers["x-org-id"] = orgId;
    }
    return config;
  });

  client.interceptors.response.use(
    (res) => res,
    async (error: AxiosError) => {
      const originalRequest = error.config as (typeof error.config & { _retry?: boolean });
      if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
        originalRequest._retry = true;
        const session = await getSession();
        const token = (session as any)?.accessToken;
        if (token && !(session as any)?.error) {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return client(originalRequest);
        }
        await signOut({ callbackUrl: "/login" });
      }
      return Promise.reject(error);
    }
  );

  return client;
}

export const api = createApiClient();

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  me: () => api.get("/api/v1/auth/me"),
  register: (data: {
    company_name: string;
    first_name: string;
    last_name: string;
    email: string;
    password: string;
  }) => api.post("/api/v1/auth/register", data),
  forgotPassword: (email: string) => api.post("/api/v1/auth/forgot-password", { email }),
  resetPassword: (data: { token: string; new_password: string }) =>
    api.post("/api/v1/auth/reset-password", data),
  changePassword: (data: { current_password: string; new_password: string }) =>
    api.post("/api/v1/auth/change-password", data),
  updateProfile: (data: { first_name?: string; last_name?: string }) =>
    api.put("/api/v1/auth/profile", data),
  logout: (refreshToken?: string) =>
    api.post("/api/v1/auth/logout", { refresh_token: refreshToken }),
};

// ─── Email one-time codes (sign-in without an authenticator, + registration) ──
export const otpApi = {
  resendLogin: (otpToken: string) =>
    api.post("/api/v1/auth/otp/resend", { otp_token: otpToken }),
  startRegistration: (data: {
    company_name: string;
    first_name: string;
    last_name: string;
    email: string;
    password: string;
  }) => api.post("/api/v1/auth/register/start", data),
  resendRegistration: (email: string) =>
    api.post("/api/v1/auth/register/resend", { email }),
  verifyRegistration: (email: string, code: string) =>
    api.post("/api/v1/auth/register/verify", { email, code }),
};

// ─── Employees ───────────────────────────────────────────────────────────────
export const employeeApi = {
  list: (params?: Record<string, any>) => api.get("/api/v1/employees", { params }),
  get: (id: string) => api.get(`/api/v1/employees/${id}`),
  create: (data: any) => api.post("/api/v1/employees", data),
  update: (id: string, data: any) => api.put(`/api/v1/employees/${id}`, data),
  delete: (id: string) => api.delete(`/api/v1/employees/${id}`),
  bulkDelete: (ids: string[]) => api.post("/api/v1/employees/bulk-delete", { ids }),
  importCsv: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post("/api/v1/employees/import", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  exportCsv: () => api.get("/api/v1/employees/export", { responseType: "blob" }),
  activity: (id: string, params?: Record<string, any>) =>
    api.get(`/api/v1/employees/${id}/activity`, { params }),
  setPortalPassword: (id: string, password: string) =>
    api.post(`/api/v1/employees/${id}/portal-password`, { password }),
  departments: () => api.get("/api/v1/employees/departments"),
};

// ─── Teams ────────────────────────────────────────────────────────────────────
export const teamApi = {
  list: (params?: Record<string, any>) => api.get("/api/v1/teams", { params }),
  get: (id: string) => api.get(`/api/v1/teams/${id}`),
  create: (data: any) => api.post("/api/v1/teams", data),
  update: (id: string, data: any) => api.put(`/api/v1/teams/${id}`, data),
  delete: (id: string) => api.delete(`/api/v1/teams/${id}`),
  assignEmployees: (id: string, data: { employee_ids: string[]; replace?: boolean }) =>
    api.post(`/api/v1/teams/${id}/employees`, data),
  removeEmployee: (teamId: string, empId: string) =>
    api.delete(`/api/v1/teams/${teamId}/employees/${empId}`),
  members: (id: string) => api.get(`/api/v1/teams/${id}/members`),
};

// ─── Policies ─────────────────────────────────────────────────────────────────
export const policyApi = {
  list: (params?: Record<string, any>) => api.get("/api/v1/policies", { params }),
  get: (id: string) => api.get(`/api/v1/policies/${id}`),
  create: (data: any) => api.post("/api/v1/policies", data),
  update: (id: string, data: any) => api.put(`/api/v1/policies/${id}`, data),
  delete: (id: string) => api.delete(`/api/v1/policies/${id}`),
  toggle: (id: string) => api.patch(`/api/v1/policies/${id}/toggle`),
  duplicate: (id: string) => api.post(`/api/v1/policies/${id}/duplicate`),
  assign: (id: string, data: any) => api.post(`/api/v1/policies/${id}/assign`, data),
  exportJson: (id: string) => api.get(`/api/v1/policies/${id}/export`),
  importJson: (data: any) => api.post("/api/v1/policies/import", data),
  types: () => api.get("/api/v1/policies/types"),
  resolvedDomains: (id: string) => api.get(`/api/v1/policies/${id}/resolved-domains`),
  blockedEmployees: (id: string) => api.get(`/api/v1/policies/${id}/blocked-employees`),
};

// ─── CASB ─────────────────────────────────────────────────────────────────────
export const casbApi = {
  listRules: () => api.get("/api/v1/casb/rules"),
  createRule: (data: any) => api.post("/api/v1/casb/rules", data),
  updateRule: (id: string, data: any) => api.put(`/api/v1/casb/rules/${id}`, data),
  toggleRule: (id: string) => api.patch(`/api/v1/casb/rules/${id}/toggle`),
  deleteRule: (id: string) => api.delete(`/api/v1/casb/rules/${id}`),
  appControl: (data: {
    app?: string;
    category?: string;
    activity?: string;
    sanctioned?: boolean;
    risk_score?: number;
  }) => api.post("/api/v1/casb/app-control", data),
  oobAnalyze: (data: { provider?: string; files: any[] }) =>
    api.post("/api/v1/casb/oob/analyze", data),
};

// ─── Shadow IT ─────────────────────────────────────────────────────────────────
export const shadowItApi = {
  apps: (params?: Record<string, any>) => api.get("/api/v1/shadow-it/apps", { params }),
  sanction: (data: { domain: string; action: "sanction" | "unsanction" | "unreviewed" }) =>
    api.post("/api/v1/shadow-it/apps/sanction", data),
};

// ─── DLP ─────────────────────────────────────────────────────────────────────
export const dlpApi = {
  // "Test a sample": run pasted text through the org's DLP scoring (a specific
  // policy if policy_id is given, otherwise all enabled DLP policies). Nothing
  // is persisted.
  test: (data: { text: string; policy_id?: string; filename?: string; content_type?: string }) =>
    api.post("/api/v1/dlp/test", data),
};

// ─── Access Requests ────────────────────────────────────────────────────────────
export const accessRequestApi = {
  list: (params?: Record<string, any>) => api.get("/api/v1/access-requests", { params }),
  approve: (id: string, note?: string) => api.post(`/api/v1/access-requests/${id}/approve`, { note }),
  deny: (id: string, note?: string) => api.post(`/api/v1/access-requests/${id}/deny`, { note }),
};

// ─── Activity ────────────────────────────────────────────────────────────────
export const activityApi = {
  list: (params?: Record<string, any>) => api.get("/api/v1/activity", { params }),
  stats: (params?: Record<string, any>) => api.get("/api/v1/activity/stats", { params }),
};

// ─── Devices ─────────────────────────────────────────────────────────────────
export const deviceApi = {
  list: (params?: Record<string, any>) => api.get("/api/v1/devices", { params }),
  get: (id: string) => api.get(`/api/v1/devices/${id}`),
  revoke: (id: string) => api.delete(`/api/v1/devices/${id}`),
  setOwnership: (id: string, ownership: "company" | "personal") =>
    api.patch(`/api/v1/devices/${id}`, { ownership }),
  enforcement: (id: string) => api.get(`/api/v1/devices/${id}/enforcement`),
  putSchedule: (id: string, data: Record<string, any>) =>
    api.put(`/api/v1/devices/${id}/schedule`, data),
  deleteSchedule: (id: string) => api.delete(`/api/v1/devices/${id}/schedule`),
};

// ─── SWG ─────────────────────────────────────────────────────────────────────
export const swgApi = {
  listRules: (params?: Record<string, any>) => api.get("/api/v1/swg/rules", { params }),
  createRule: (data: any) => api.post("/api/v1/swg/rules", data),
  deleteRule: (id: string) => api.delete(`/api/v1/swg/rules/${id}`),
  categories: () => api.get("/api/v1/swg/categories"),
  stats: () => api.get("/api/v1/swg/stats"),
  checkUrl: (url: string) => api.post("/api/v1/swg/check", { url }),
};

// ─── URL Categories ──────────────────────────────────────────────────────────
export const categoryApi = {
  list: (params?: Record<string, any>) => api.get("/api/v1/categories", { params }),
  domains: (id: string, params?: Record<string, any>) =>
    api.get(`/api/v1/categories/${id}/domains`, { params }),
  addDomains: (id: string, data: { domain?: string; domains?: string[] }) =>
    api.post(`/api/v1/categories/${id}/domains`, data),
  deleteDomain: (id: string, domain: string) =>
    api.delete(`/api/v1/categories/${id}/domains`, { params: { domain } }),
};

// ─── Application control ─────────────────────────────────────────────────────
export const appControlApi = {
  catalog: () => api.get("/api/v1/applications/catalog"),
  listRules: () => api.get("/api/v1/applications/rules"),
  createRule: (data: {
    application_id: string;
    action?: string;
    enabled?: boolean;
    block_network?: boolean;
    block_process?: boolean;
  }) => api.post("/api/v1/applications/rules", data),
  updateRule: (id: string, data: Record<string, any>) =>
    api.patch(`/api/v1/applications/rules/${id}`, data),
  deleteRule: (id: string) => api.delete(`/api/v1/applications/rules/${id}`),
  events: () => api.get("/api/v1/applications/events"),
  createApplication: (data: {
    name: string;
    vendor?: string;
    category?: string;
    description?: string;
    risk_level?: number;
    process_names?: string[];
    bundle_ids?: string[];
    path_patterns?: string[];
    domains?: string[];
  }) => api.post("/api/v1/applications", data),
  deleteApplication: (id: string) => api.delete(`/api/v1/applications/${id}`),
};

// ─── Time & activity monitoring (screenshots) ────────────────────────────────
export const monitoringApi = {
  employees: () => api.get("/api/v1/monitoring/employees"),
  screenshots: (params: { employee_id: string; date: string; tz?: string; day_reset?: number }) =>
    api.get("/api/v1/monitoring/screenshots", { params }),
  getSettings: () => api.get("/api/v1/monitoring/settings"),
  updateSettings: (data: Record<string, any>) => api.put("/api/v1/monitoring/settings", data),
  deleteSession: (id: string) => api.delete(`/api/v1/monitoring/sessions/${id}`),
  deleteScreenshot: (id: string) => api.delete(`/api/v1/monitoring/screenshots/${id}`),
};

// ─── Working hours (enforcement schedules) ───────────────────────────────────
export const enforcementApi = {
  getOrgSchedule: () => api.get("/api/v1/enforcement/schedule"),
  putOrgSchedule: (data: Record<string, any>) => api.put("/api/v1/enforcement/schedule", data),
  deleteOrgSchedule: () => api.delete("/api/v1/enforcement/schedule"),
  listSchedules: () => api.get("/api/v1/enforcement/schedules"),
  putTeamSchedule: (id: string, data: Record<string, any>) =>
    api.put(`/api/v1/teams/${id}/schedule`, data),
  deleteTeamSchedule: (id: string) => api.delete(`/api/v1/teams/${id}/schedule`),
};

// ─── Settings ────────────────────────────────────────────────────────────────
export const settingsApi = {
  getMITM: () => api.get("/api/v1/settings/mitm"),
  updateMITM: (data: { enabled: boolean; bypass_domains: string[] }) =>
    api.put("/api/v1/settings/mitm", data),
  mitmPlatforms: () => api.get("/api/v1/settings/mitm/platforms"),
  discoverBypass: (query: string) =>
    api.get("/api/v1/settings/mitm/discover", { params: { query } }),
};

// ─── AI Chat ─────────────────────────────────────────────────────────────────
export type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * Streams an agentic reply. The AI service is stateless, so the whole thread is
 * sent each turn — without it the assistant can't answer a follow-up like
 * "yes, apply it to the Sales team".
 */
export async function* streamChat(
  messages: ChatTurn[],
  opts: { accessToken: string; orgId: string; orgName?: string; signal?: AbortSignal }
) {
  const res = await fetch(`${AI_URL}/api/v1/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.accessToken}`,
      "x-org-id": opts.orgId,
    },
    signal: opts.signal,
    body: JSON.stringify({
      messages,
      agent_mode: true,
      org_name: opts.orgName || "Your organization",
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI request failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") return;
        try {
          yield JSON.parse(raw);
        } catch {
          // non-JSON SSE line
        }
      }
    }
  }
}

// ─── AI conversations (stored by admin-api) ──────────────────────────────────
export const aiChatApi = {
  listSessions: () => api.get("/api/v1/ai/sessions"),
  createSession: (data?: { title?: string }) => api.post("/api/v1/ai/sessions", data ?? {}),
  getSession: (id: string) => api.get(`/api/v1/ai/sessions/${id}`),
  renameSession: (id: string, title: string) => api.patch(`/api/v1/ai/sessions/${id}`, { title }),
  deleteSession: (id: string) => api.delete(`/api/v1/ai/sessions/${id}`),
  addMessage: (id: string, data: { role: string; content: string; tool_name?: string; tool_calls?: any }) =>
    api.post(`/api/v1/ai/sessions/${id}/messages`, data),
};

// ─── Reports & analytics ─────────────────────────────────────────────────────
export const reportApi = {
  overview: (params?: Record<string, any>) => api.get("/api/v1/reports/overview", { params }),
  catalog: () => api.get("/api/v1/reports/catalog"),
  get: (type: string, params?: Record<string, any>) =>
    api.get(`/api/v1/reports/${type}`, { params }),
  exportCsv: (type: string, params?: Record<string, any>) =>
    api.get(`/api/v1/reports/${type}`, { params: { ...params, format: "csv" }, responseType: "blob" }),
};

// ─── Dashboard users (RBAC) ──────────────────────────────────────────────────
export const orgUserApi = {
  list: (params?: Record<string, any>) => api.get("/api/v1/users", { params }),
  create: (data: any) => api.post("/api/v1/users", data),
  update: (id: string, data: any) => api.put(`/api/v1/users/${id}`, data),
  delete: (id: string) => api.delete(`/api/v1/users/${id}`),
};

// ─── Multi-factor authentication ─────────────────────────────────────────────
export const mfaApi = {
  status: () => api.get("/api/v1/auth/mfa/status"),
  setup: () => api.post("/api/v1/auth/mfa/setup"),
  enable: (code: string) => api.post("/api/v1/auth/mfa/enable", { code }),
  disable: (password: string) => api.post("/api/v1/auth/mfa/disable", { password }),
  regenerateCodes: (password: string) => api.post("/api/v1/auth/mfa/recovery-codes", { password }),
  orgPolicy: () => api.get("/api/v1/settings/mfa"),
  setOrgPolicy: (required: boolean) => api.put("/api/v1/settings/mfa", { required }),
};

// ─── Company profile ─────────────────────────────────────────────────────────
export const companyApi = {
  get: () => api.get("/api/v1/organization"),
  update: (data: any) => api.put("/api/v1/organization", data),
  timezones: () => api.get("/api/v1/organization/timezones"),
  updateNotifications: (data: any) => api.put("/api/v1/organization/notifications", data),
};
