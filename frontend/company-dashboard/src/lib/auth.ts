import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import AppleProvider from "next-auth/providers/apple";
import axios from "axios";

const API_URL =
  process.env.NEXTAUTH_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://admin-api:6000";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "";
const useSecureCookies = process.env.NEXTAUTH_URL?.startsWith("https://") ?? false;

const providers: NextAuthOptions["providers"] = [
  CredentialsProvider({
    name: "credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
      // Second factor. Absent on the first attempt: the backend answers with
      // MFA_REQUIRED, the login page collects a code, and we come back here.
      mfaCode: { label: "Authentication code", type: "text" },
      mfaToken: { label: "MFA token", type: "text" },
      otpCode: { label: "Email code", type: "text" },
      otpToken: { label: "OTP token", type: "text" },
      // Finishing a sign-up: the emailed code creates the org and signs in.
      regCode: { label: "Registration code", type: "text" },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials.password) return null;

      // next-auth builds its request body with URLSearchParams, so a field the
      // caller left out arrives as the literal string "undefined". Treated as a
      // real value it would send every first sign-in straight to code
      // verification with a bogus code.
      const field = (v?: string) => {
        const t = (v ?? "").trim();
        return t === "undefined" || t === "null" ? "" : t;
      };
      const mfaCode = field(credentials.mfaCode);
      const mfaToken = field(credentials.mfaToken);
      const otpCode = field(credentials.otpCode);
      const otpToken = field(credentials.otpToken);
      const regCode = field(credentials.regCode);

      const session = (data: any) => ({
        id: data.user.id,
        email: data.user.email,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        accessTokenExpires: Date.now() + data.expires_in * 1000,
        ...data.user,
      });

      try {
        // Registration completes here so the new account lands straight in a
        // session instead of being asked for a second code.
        if (regCode) {
          const created = await axios.post(`${API_URL}/api/v1/auth/register/verify`, {
            email: credentials.email,
            code: regCode,
          });
          if (created.data?.access_token) return session(created.data);
          return null;
        }

        // A code plus a challenge token means we're finishing a sign-in that
        // already passed the password step — go straight to verification.
        if (mfaCode && mfaToken) {
          try {
            const verified = await axios.post(`${API_URL}/api/v1/auth/mfa/verify`, {
              mfa_token: mfaToken,
              code: mfaCode,
            });
            if (verified.data?.access_token) return session(verified.data);
            return null;
          } catch (verifyErr: any) {
            // The challenge lapsed while the user was fetching their code. We
            // still hold their password, so mint a fresh challenge and verify
            // again rather than making them start over — the code itself is
            // time-based and still valid.
            if (verifyErr.response?.data?.code !== "MFA_CHALLENGE_EXPIRED") throw verifyErr;

            const reissued = await axios.post(`${API_URL}/api/v1/auth/login`, {
              email: credentials.email,
              password: credentials.password,
              panel: "company",
            });
            if (!reissued.data?.mfa_token) throw verifyErr;

            const retried = await axios.post(`${API_URL}/api/v1/auth/mfa/verify`, {
              mfa_token: reissued.data.mfa_token,
              code: mfaCode,
            });
            if (retried.data?.access_token) return session(retried.data);
            return null;
          }
        }

        if (otpCode && otpToken) {
          try {
            const verified = await axios.post(`${API_URL}/api/v1/auth/otp/verify`, {
              otp_token: otpToken,
              code: otpCode,
            });
            if (verified.data?.access_token) return session(verified.data);
            return null;
          } catch (otpErr: any) {
            // Only the challenge wrapper expires here — the emailed code itself
            // is still valid, so re-authenticate and verify it again.
            if (otpErr.response?.data?.code !== "OTP_CHALLENGE_EXPIRED") throw otpErr;

            const reissued = await axios.post(`${API_URL}/api/v1/auth/login`, {
              email: credentials.email,
              password: credentials.password,
              panel: "company",
            });
            if (!reissued.data?.otp_token) throw otpErr;

            const retried = await axios.post(`${API_URL}/api/v1/auth/otp/verify`, {
              otp_token: reissued.data.otp_token,
              code: otpCode,
            });
            if (retried.data?.access_token) return session(retried.data);
            return null;
          }
        }

        const res = await axios.post(`${API_URL}/api/v1/auth/login`, {
          email: credentials.email,
          password: credentials.password,
          panel: "company",
        });
        const data = res.data;

        // The password was right, but the account (or the org) needs a second
        // factor. The challenge token travels back through the error message,
        // since NextAuth only lets authorize() return a user or throw.
        if (data.mfa_required || data.mfa_setup_required) {
          const kind = data.mfa_setup_required ? "MFA_SETUP_REQUIRED" : "MFA_REQUIRED";
          throw new Error(`${kind}:${data.mfa_token}`);
        }
        if (data.otp_required) {
          // The masked address rides along so the code screen can say where the
          // email went without a second round-trip.
          throw new Error(`OTP_REQUIRED:${data.otp_token}|${data.email ?? ""}`);
        }

        if (data.access_token) return session(data);
        return null;
      } catch (err: any) {
        // Re-throw our own signals untouched so the page can act on them.
        if (
          typeof err?.message === "string" &&
          (err.message.startsWith("MFA_") || err.message.startsWith("OTP_REQUIRED:"))
        ) {
          throw err;
        }
        const msg = err.response?.data?.error || "Invalid email or password";
        throw new Error(msg);
      }
    },
  }),
  // "View as Org" from the superadmin panel: exchanges the one-time code
  // superadmin minted for a real session, via the same internal-secret-gated
  // backend exchange the social-login signIn callback below uses. The
  // backend deliberately returns no refresh token for this path, so the
  // resulting session dies on its own in 15 minutes with nothing to revoke.
  CredentialsProvider({
    id: "impersonation",
    name: "impersonation",
    credentials: { code: { label: "Code", type: "text" } },
    async authorize(credentials) {
      if (!credentials?.code) return null;
      try {
        const res = await axios.post(
          `${API_URL}/api/v1/auth/impersonate/consume`,
          { code: credentials.code },
          { headers: { "X-Internal-Secret": INTERNAL_API_SECRET } }
        );
        const data = res.data;
        if (!data.access_token) return null;
        return {
          id: data.user.id,
          email: data.user.email,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          accessTokenExpires: Date.now() + data.expires_in * 1000,
          ...data.user,
        };
      } catch (err: any) {
        throw new Error(err.response?.data?.error || "This impersonation link is invalid or has expired");
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

type RefreshResult = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpires: number;
};

// Every API call runs getSession(), which runs the jwt callback below — so the
// moment an access token expires, a burst of requests would each POST to
// /auth/refresh with the same refresh token. The backend rotates on use, so
// only the first would win and the rest would be signed out. Collapsing them
// onto one in-flight promise per refresh token keeps it to a single call.
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
  providers,
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  callbacks: {
    // For Google/Apple, exchange the verified email for our own JWT via the
    // internal-secret-gated backend endpoint. Only logs in an *existing*
    // user — social sign-in never creates an organization on its own.
    async signIn({ user, account }) {
      if (account?.provider === "google" || account?.provider === "apple") {
        if (!user.email) return "/login?error=NoEmailFromProvider";
        try {
          const res = await axios.post(
            `${API_URL}/api/v1/auth/social`,
            { email: user.email },
            { headers: { "X-Internal-Secret": INTERNAL_API_SECRET } }
          );
          const data = res.data;
          (user as any).accessToken = data.access_token;
          (user as any).refreshToken = data.refresh_token;
          (user as any).accessTokenExpires = Date.now() + data.expires_in * 1000;
          Object.assign(user as any, data.user);
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
            role: (user as any).role,
            org_id: (user as any).org_id,
            // The header's org badge reads this; without it the badge fell
            // back to the literal word "Organization" for everyone.
            org_name: (user as any).org?.name ?? null,
            // RBAC facts, so the dashboard renders what this person may use.
            permissions: (user as any).permissions ?? [],
            team_ids: (user as any).team_ids ?? [],
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
      (session as any).refreshToken = token.refreshToken;
      (session as any).error = token.error;
      (session as any).user = token.user;
      return session;
    },
  },
  pages: { signIn: "/login", error: "/login" },
  secret: process.env.NEXTAUTH_SECRET,
  cookies: {
    sessionToken: {
      name: "aavishield-company.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
  },
};
