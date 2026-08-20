import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import AppleProvider from "next-auth/providers/apple";
import { cookies } from "next/headers";
import axios from "axios";

const API_URL =
  process.env.NEXTAUTH_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://admin-api:6000";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";
const useSecureCookies = process.env.NEXTAUTH_URL?.startsWith("https://") ?? false;

type RefreshResult = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpires: number;
};

// Portal access tokens last 8 hours; this swaps in a fresh one instead of
// bouncing the employee back to the login screen. Concurrent callers share a
// single request per token, because the backend rotates refresh tokens on use.
const inFlightRefresh = new Map<string, Promise<RefreshResult>>();

function refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
  const pending = inFlightRefresh.get(refreshToken);
  if (pending) return pending;

  const request = axios
    .post(`${API_URL}/api/v1/portal/refresh`, { refresh_token: refreshToken })
    .then((res) => ({
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token ?? refreshToken,
      accessTokenExpires: Date.now() + (res.data.expires_in ?? 8 * 3600) * 1000,
    }))
    .finally(() => {
      inFlightRefresh.delete(refreshToken);
    });

  inFlightRefresh.set(refreshToken, request);
  return request;
}

const providers: NextAuthOptions["providers"] = [
  CredentialsProvider({
    name: "credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials.password) return null;
      try {
        const res = await axios.post(`${API_URL}/api/v1/portal/login`, {
          email: credentials.email,
          password: credentials.password,
        });
        const data = res.data;
        if (data.access_token) {
          return {
            id: data.employee.id,
            email: data.employee.email,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            accessTokenExpires: Date.now() + data.expires_in * 1000,
            ...data.employee,
          };
        }
        return null;
      } catch (err: any) {
        const msg = err.response?.data?.error || "Invalid email or password";
        throw new Error(msg);
      }
    },
  }),
];

// Only registered when credentials are configured — buttons still render in
// the UI, but clicking them will error until GOOGLE_CLIENT_ID/SECRET (and the
// Apple equivalents) are set in .env.
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  );
}
if (process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET) {
  providers.push(
    AppleProvider({
      clientId: process.env.APPLE_CLIENT_ID,
      clientSecret: process.env.APPLE_CLIENT_SECRET,
    })
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  callbacks: {
    // For Google/Apple, the login page stashes the company code in a
    // short-lived cookie right before redirecting to the provider (portal
    // employee lookups always need an org, unlike the company-dashboard
    // flow). Only logs in an existing, already-activated employee record.
    async signIn({ user, account }) {
      if (account?.provider === "google" || account?.provider === "apple") {
        if (!user.email) return "/login?error=NoEmailFromProvider";
        const companyCode = cookies().get("portal_company_code")?.value || "";
        if (!companyCode) return "/login?error=MissingCompanyCode";
        try {
          const res = await axios.post(
            `${API_URL}/api/v1/portal/social`,
            { company_code: companyCode, email: user.email },
            { headers: { "X-Internal-Secret": INTERNAL_API_SECRET } }
          );
          const data = res.data;
          (user as any).accessToken = data.access_token;
          (user as any).refreshToken = data.refresh_token;
          (user as any).accessTokenExpires = Date.now() + data.expires_in * 1000;
          Object.assign(user as any, data.employee);
          return true;
        } catch {
          return "/login?error=NoAccountFound";
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        return {
          ...token,
          accessToken: (user as any).accessToken,
          refreshToken: (user as any).refreshToken,
          accessTokenExpires: (user as any).accessTokenExpires,
          user: {
            id: user.id,
            email: user.email,
            first_name: (user as any).first_name,
            last_name: (user as any).last_name,
            full_name: (user as any).full_name,
            department: (user as any).department,
            job_title: (user as any).job_title,
            org_id: (user as any).org_id,
            device_count: (user as any).device_count,
          },
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
      (session as any).accessToken = token.accessToken;
      (session as any).error = token.error;
      (session as any).user = token.user;
      return session;
    },
  },
  pages: { signIn: "/login", error: "/login" },
  secret: process.env.NEXTAUTH_SECRET,
  cookies: {
    sessionToken: {
      name: "aavishield-employee.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
  },
};
