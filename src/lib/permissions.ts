import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Db } from "mongodb";
import { ApiError } from "@/lib/api";
import { validateSession, type AdminContext } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/csrf";
import { getDb } from "@/lib/mongodb";
import { SESSION_COOKIE } from "@/lib/session-config";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Authorization gate for EVERY admin API route. The proxy only does a cheap cookie-presence check;
 * this is the check that counts: it validates the session against the database on every call.
 * (There is a single administrator role today, so being authenticated means being authorised.
 * Add role checks here if more roles are introduced.)
 */
export async function requireAdminApi(req: NextRequest, db?: Db): Promise<AdminContext> {
  if (!SAFE_METHODS.has(req.method)) assertSameOrigin(req);
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) throw new ApiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  const ctx = await validateSession(db ?? (await getDb()), token);
  if (!ctx) throw new ApiError(401, "UNAUTHENTICATED", "Your session has ended. Sign in again.");
  return ctx;
}

/** For server components: the signed-in admin, or null. */
export async function getCurrentAdmin(): Promise<AdminContext | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSession(await getDb(), token);
}

/** For admin pages. Call this in every page, not just the layout: layouts are not re-run on every navigation. */
export async function requireAdminPage(): Promise<AdminContext> {
  const ctx = await getCurrentAdmin();
  if (!ctx) redirect("/admin/login");
  return ctx;
}
