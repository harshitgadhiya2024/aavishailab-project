import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: string;
    user?: {
      id: string;
      email: string;
      first_name?: string;
      last_name?: string;
      full_name?: string;
      department?: string;
      job_title?: string;
      org_id?: string;
      device_count?: number;
    };
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
