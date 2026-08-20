import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    refreshToken?: string;
    error?: string;
    user: {
      id?: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
      first_name?: string;
      last_name?: string;
      full_name?: string;
      role?: string;
      org_id?: string;
      org_name?: string | null;
      permissions?: string[];
      team_ids?: string[];
    };
  }

  interface User {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    first_name?: string;
    last_name?: string;
    full_name?: string;
    role?: string;
    org_id?: string;
    org?: { id?: string; name?: string; slug?: string } | null;
    permissions?: string[];
    team_ids?: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    error?: string;
    user?: Session["user"];
  }
}
