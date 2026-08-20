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
  devices: () => api.get("/api/v1/portal/devices"),
  deleteDevice: (id: string) => api.delete(`/api/v1/portal/devices/${id}`),
  activity: (params?: Record<string, unknown>) =>
    api.get("/api/v1/portal/activity", { params }),
  activityStats: (params?: Record<string, unknown>) =>
    api.get("/api/v1/portal/activity/stats", { params }),
  requestAccess: (data: { policy_id: string; domain: string; reason?: string }) =>
    api.post("/api/v1/portal/access-requests", data),
  accessRequests: () => api.get("/api/v1/portal/access-requests"),
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
