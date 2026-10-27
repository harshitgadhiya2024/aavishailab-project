import NextAuth from "next-auth";
import { NextRequest } from "next/server";
import { authOptions } from "@/lib/auth";
import { DEMO_SESSION, isDemo } from "@/lib/demo";

const handler = NextAuth(authOptions);

export async function GET(req: NextRequest, ctx: any) {
  if (isDemo && req.nextUrl.pathname.endsWith("/session")) {
    return Response.json(DEMO_SESSION);
  }
  return handler(req, ctx);
}

export { handler as POST };
