import axios, { AxiosInstance, AxiosError } from "axios";
import { getSession, signOut } from "next-auth/react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:6000";

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
    }
    return config;
  });

  client.interceptors.response.use(
    (res) => res,
    async (error: AxiosError) => {
      if (error.response?.status === 401) {
        await signOut({ callbackUrl: "/login" });
      }
      return Promise.reject(error);
    }
  );

  return client;
}

export const api = createApiClient();

export const portalApi = {
  signup: (data: { company_code: string; email: string; password: string }) =>
    api.post("/api/v1/portal/signup", data),
  forgotPassword: (data: { company_code: string; email: string }) =>
    api.post("/api/v1/portal/forgot-password", data),
  resetPassword: (data: { token: string; new_password: string }) =>
    api.post("/api/v1/portal/reset-password", data),
  me: () => api.get("/api/v1/portal/me"),
  changePassword: (data: { current_password: string; new_password: string }) =>
    api.post("/api/v1/portal/change-password", data),
  devices: () => api.get("/api/v1/portal/devices"),
  deleteDevice: (id: string) => api.delete(`/api/v1/portal/devices/${id}`),
  activity: (params?: Record<string, unknown>) =>
    api.get("/api/v1/portal/activity", { params }),
  activityStats: (params?: Record<string, unknown>) =>
    api.get("/api/v1/portal/activity/stats", { params }),
  /** Ask the company for an exception to what an activity row stopped. */
  requestAccess: (data: { event_id: string; reason: string }) =>
    api.post("/api/v1/portal/access-requests", data),
  accessRequests: () => api.get("/api/v1/portal/access-requests"),
  /** Everything the dashboard shows for one period ({start, end, tz}). */
  overview: (params: { start: string; end: string; tz: string }) =>
    api.get("/api/v1/portal/overview", { params }),
  // Own screenshots only (the employee comes from the token). Read + reason;
  // there is deliberately no delete call here.
  screenshots: (params: { date: string; tz: string; day_reset?: number }) =>
    api.get("/api/v1/portal/screenshots", { params }),
  setScreenshotReason: (id: string, reason: string) =>
    api.put(`/api/v1/portal/screenshots/${id}/reason`, { reason }),
  notifications: () => api.get("/api/v1/portal/notifications"),
  markNotificationsRead: () => api.post("/api/v1/portal/notifications/read"),
  markNotificationRead: (id: string) => api.post(`/api/v1/portal/notifications/${id}/read`),
  withdrawAccessRequest: (id: string) => api.post(`/api/v1/portal/access-requests/${id}/withdraw`),
  downloadUninstaller: async (os: "macos" | "windows" | "linux") => {
    const session = await getSession();
    const token = (session as any)?.accessToken;
    const res = await fetch(`${API_URL}/api/v1/portal/uninstall/${os}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const filenames: Record<string, string> = {
      macos: "aavishield-uninstall.command",
      windows: "aavishield-uninstall.bat",
      linux: "aavishield-uninstall.sh",
    };
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filenames[os];
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  },
  installerInfo: (os: "macos" | "windows" | "linux") =>
    api.get(`/api/v1/portal/installer-info/${os}`),
  enrollDevice: () => api.post("/api/v1/portal/enroll-device"),
  downloadInstaller: async (os: "macos" | "windows" | "linux") => {
    const session = await getSession();
    const token = (session as any)?.accessToken;
    const res = await fetch(`${API_URL}/api/v1/portal/download/${os}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Download failed" }));
      throw new Error(err.error || "Download failed");
    }
    const blob = await res.blob();
    const filenames: Record<string, string> = {
      macos: "aavishield-install.command",
      windows: "aavishield-install.bat",
      linux: "aavishield-install.sh",
    };
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filenames[os];
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
