import axios, { AxiosInstance, AxiosError } from "axios";
import { getSession, signOut } from "next-auth/react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:6000";

export function createApiClient(token?: string): AxiosInstance {
  const client = axios.create({
    baseURL: `${API_URL}/api/v1`,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    timeout: 30000,
  });

  // Auto-attach token from session
  client.interceptors.request.use(async (config) => {
    if (!config.headers.Authorization) {
      const session = await getSession();
      if (session?.accessToken) {
        config.headers.Authorization = `Bearer ${session.accessToken}`;
      }
    }
    return config;
  });

  // Handle 401 → retry once after session refresh, then sign out
  client.interceptors.response.use(
    (res) => res,
    async (error: AxiosError) => {
      const originalRequest = error.config as (typeof error.config & { _retry?: boolean });
      if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
        originalRequest._retry = true;
        const session = await getSession();
        if (session?.accessToken && !session.error) {
          originalRequest.headers.Authorization = `Bearer ${session.accessToken}`;
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

// ─── API helpers ─────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    api.post("/auth/login", { email, password, panel: "superadmin" }),
  refresh: (refreshToken: string) =>
    api.post("/auth/refresh", { refresh_token: refreshToken }),
  logout: (refreshToken?: string) =>
    api.post("/auth/logout", { refresh_token: refreshToken }),
  me: () => api.get("/auth/me"),
  changePassword: (data: { current_password: string; new_password: string }) =>
    api.post("/auth/change-password", data),
  updateProfile: (data: { first_name?: string; last_name?: string }) =>
    api.put("/auth/profile", data),
};

export const orgApi = {
  list: (params?: Record<string, any>) =>
    api.get("/superadmin/organizations", { params }),
  get: (id: string) => api.get(`/superadmin/organizations/${id}`),
  create: (data: any) => api.post("/superadmin/organizations", data),
  update: (id: string, data: any) => api.put(`/superadmin/organizations/${id}`, data),
  delete: (id: string) => api.delete(`/superadmin/organizations/${id}`),
  stats: () => api.get("/superadmin/stats"),
};
