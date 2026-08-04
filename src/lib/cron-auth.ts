import { timingSafeEqual } from "node:crypto";
import { getEnv } from "./env";

/**
 * Guard for /api/cron/* routes.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without this the
 * route is an unauthenticated endpoint that burns the provider rate limit for
 * anyone who finds it. The env schema requires CRON_SECRET in production, so
 * the unauthenticated path below is reachable in development only.
 */
export function isAuthorizedCronRequest(req: Request): boolean {
  const expected = getEnv().CRON_SECRET;
  if (!expected) return getEnv().NODE_ENV !== "production";

  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
