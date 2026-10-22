import { ConvexError, v } from "convex/values";
import {
  internalQuery,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";

export type MarketingRole = "admin" | "member";
export interface MarketingMembership {
  email: string;
  role: MarketingRole;
}

type AnyCtx = QueryCtx | MutationCtx | ActionCtx;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function forbidden(): ConvexError<{ code: "MARKETING_FORBIDDEN" }> {
  return new ConvexError({ code: "MARKETING_FORBIDDEN" as const });
}

/**
 * Resolve a marketing membership for an email, without checking identity.
 * The bootstrap admin (Convex env MARKETING_BOOTSTRAP_ADMIN_EMAIL) needs no row.
 * Never throws.
 */
export async function findMarketingMemberByEmail(
  ctx: AnyCtx,
  email: string,
): Promise<MarketingMembership | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  // Read env inside the function, never at module scope.
  const bootstrap = normalizeEmail(process.env.MARKETING_BOOTSTRAP_ADMIN_EMAIL ?? "");
  if (bootstrap && normalized === bootstrap) {
    return { email: normalized, role: "admin" };
  }

  if ("db" in ctx) {
    const row = await ctx.db
      .query("marketingMembers")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .first();
    return row ? { email: normalized, role: row.role } : null;
  }

  const row = await ctx.runQuery(internal.marketing.access.getMemberByEmail, { email: normalized });
  return row ? { email: normalized, role: row.role } : null;
}

/**
 * The signed-in caller's membership, or null for no identity, an unverified
 * email, or no membership. Never throws.
 */
export async function getMyMembership(ctx: AnyCtx): Promise<MarketingMembership | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  if (identity.emailVerified !== true) return null;
  const email = typeof identity.email === "string" ? identity.email.trim() : "";
  if (!email) return null;
  return findMarketingMemberByEmail(ctx, email);
}

/** Like getMyMembership, but throws ConvexError({ code: 'MARKETING_FORBIDDEN' }) on null. */
export async function requireMarketingMember(ctx: AnyCtx): Promise<MarketingMembership> {
  const membership = await getMyMembership(ctx);
  if (!membership) throw forbidden();
  return membership;
}

export const getMemberByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args): Promise<{ role: MarketingRole } | null> => {
    const row = await ctx.db
      .query("marketingMembers")
      .withIndex("by_email", (q) => q.eq("email", normalizeEmail(args.email)))
      .first();
    return row ? { role: row.role } : null;
  },
});

/** Public: the caller's own membership, or null. */
export const myMembership = query({
  args: {},
  handler: async (ctx): Promise<MarketingMembership | null> => getMyMembership(ctx),
});
