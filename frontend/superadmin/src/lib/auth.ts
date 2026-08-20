import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import axios from "axios";

const API_URL =
  process.env.NEXTAUTH_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://admin-api:6000";

const useSecureCookies = process.env.NEXTAUTH_URL?.startsWith("https://") ?? false;

type RefreshResult = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpires: number;
};

// One shared refresh per token: without this, every request that finds the
// access token expired fires its own /auth/refresh, and since the backend
// rotates refresh tokens on use, all but the first would fail and sign the
// user out.
const inFlightRefresh = new Map<string, Promise<RefreshResult>>();

function refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
  const pending = inFlightRefresh.get(refreshToken);
  if (pending) return pending;

  const request = axios
    .post(`${API_URL}/api/v1/auth/refresh`, { refresh_token: refreshToken })
    .then((res) => ({
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token ?? refreshToken,
      accessTokenExpires: Date.now() + (res.data.expires_in ?? 900) * 1000,
    }))
    .finally(() => {
      inFlightRefresh.delete(refreshToken);
    });

  inFlightRefresh.set(refreshToken, request);
  return request;
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  cookies: {
    sessionToken: {
      name: "aavishield-superadmin.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        try {
          const res = await axios.post(`${API_URL}/api/v1/auth/login`, {
            email: credentials.email,
            password: credentials.password,
            panel: "superadmin",
          });

          const { access_token, refresh_token, user } = res.data;
          if (!access_token || user?.role !== "superadmin") return null;

          return {
            id: user.id,
            email: user.email,
            name: user.full_name,
            role: user.role,
            accessToken: access_token,
            refreshToken: refresh_token,
            user,
          };
        } catch (err: any) {
          const msg = err.response?.data?.error || "Login failed";
          throw new Error(msg);
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const accessToken = (user as any).accessToken as string;
        const expiresIn = 15 * 60;
        return {
          ...token,
          ...user,
          accessTokenExpires: Date.now() + expiresIn * 1000,
        };
      }

      const expiresAt = (token.accessTokenExpires as number | undefined) ?? 0;
      if (expiresAt > 0 && Date.now() < expiresAt - 60_000) {
        return token;
      }

      if (!token.refreshToken) {
        return { ...token, error: "RefreshTokenError" };
      }

      try {
        const refreshed = await refreshAccessToken(token.refreshToken as string);
        return {
          ...token,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          accessTokenExpires: refreshed.accessTokenExpires,
          error: undefined,
        };
      } catch {
        return { ...token, error: "RefreshTokenError" };
      }
    },

    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      session.refreshToken = token.refreshToken as string;
      session.user = (token.user as any) || session.user;
      session.role = token.role as string;
      session.error = token.error as string;
      return session;
    },
  },
};
