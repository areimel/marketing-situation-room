import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import {
  findMarketingMemberByEmail,
  getMyMembership,
  requireMarketingMember,
} from "../marketing/access";

const modules = import.meta.glob("../**/*.ts");

const BOOTSTRAP = "boss@agency.com";
const FORBIDDEN = { code: "MARKETING_FORBIDDEN" };

function identity(email: string, emailVerified = true) {
  return {
    subject: `user-${email.trim().toLowerCase()}`,
    tokenIdentifier: `clerk|user-${email.trim().toLowerCase()}`,
    email,
    emailVerified,
  };
}

async function expectForbidden(promise: Promise<unknown>) {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ConvexError);
  // convex-test round-trips ConvexError data through JSON across the function
  // boundary (see accountDeletionWriteFence.test.ts), once per t.run layer, so
  // decode until the object comes back before comparing.
  let data: unknown = (caught as ConvexError<unknown>).data;
  for (let i = 0; i < 3 && typeof data === "string"; i++) data = JSON.parse(data);
  expect(data).toEqual(FORBIDDEN);
}

async function seedMember(
  t: ReturnType<typeof convexTest>,
  email: string,
  role: "admin" | "member",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("marketingMembers", {
      email,
      role,
      addedBy: BOOTSTRAP,
      addedAt: Date.now(),
    });
  });
}

let savedBootstrap: string | undefined;
beforeEach(() => {
  savedBootstrap = process.env.MARKETING_BOOTSTRAP_ADMIN_EMAIL;
  process.env.MARKETING_BOOTSTRAP_ADMIN_EMAIL = BOOTSTRAP;
});
afterEach(() => {
  if (savedBootstrap === undefined) delete process.env.MARKETING_BOOTSTRAP_ADMIN_EMAIL;
  else process.env.MARKETING_BOOTSTRAP_ADMIN_EMAIL = savedBootstrap;
});

describe("requireMarketingMember", () => {
  test("bootstrap admin email in mixed case resolves to admin without a row", async () => {
    const t = convexTest(schema, modules);
    const result = await t
      .withIdentity(identity("  Boss@Agency.COM "))
      .run((ctx) => requireMarketingMember(ctx));
    expect(result).toEqual({ email: BOOTSTRAP, role: "admin" });
  });

  test("seeded member row resolves to its role", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, "ops@x.com", "member");
    const result = await t
      .withIdentity(identity("ops@x.com"))
      .run((ctx) => requireMarketingMember(ctx));
    expect(result).toEqual({ email: "ops@x.com", role: "member" });
  });

  test("identity email is trimmed and lowercased before lookup", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, "ops@x.com", "admin");
    const result = await t
      .withIdentity(identity("  Ops@X.com "))
      .run((ctx) => requireMarketingMember(ctx));
    expect(result).toEqual({ email: "ops@x.com", role: "admin" });
  });

  test("verified but unlisted email is forbidden", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, "ops@x.com", "member");
    await expectForbidden(
      t.withIdentity(identity("stranger@x.com")).run((ctx) => requireMarketingMember(ctx)),
    );
  });

  test("unverified email is forbidden even when listed", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, "ops@x.com", "member");
    await expectForbidden(
      t.withIdentity(identity("ops@x.com", false)).run((ctx) => requireMarketingMember(ctx)),
    );
    await expectForbidden(
      t.withIdentity(identity(BOOTSTRAP, false)).run((ctx) => requireMarketingMember(ctx)),
    );
  });

  test("no identity is forbidden", async () => {
    const t = convexTest(schema, modules);
    await expectForbidden(t.run((ctx) => requireMarketingMember(ctx)));
  });

  test("unset bootstrap env with no rows is forbidden", async () => {
    delete process.env.MARKETING_BOOTSTRAP_ADMIN_EMAIL;
    const t = convexTest(schema, modules);
    await expectForbidden(
      t.withIdentity(identity(BOOTSTRAP)).run((ctx) => requireMarketingMember(ctx)),
    );
  });

  test("internal getMemberByEmail (the ActionCtx lookup path) returns {role} or null", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, "ops@x.com", "member");
    expect(
      await t.query(internal.marketing.access.getMemberByEmail, { email: "ops@x.com" }),
    ).toEqual({ role: "member" });
    expect(
      await t.query(internal.marketing.access.getMemberByEmail, { email: "nobody@x.com" }),
    ).toBeNull();
  });
});

describe("getMyMembership", () => {
  test("returns null without throwing for no identity, unverified and unlisted", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, "ops@x.com", "member");
    expect(await t.run((ctx) => getMyMembership(ctx))).toBeNull();
    expect(
      await t.withIdentity(identity("ops@x.com", false)).run((ctx) => getMyMembership(ctx)),
    ).toBeNull();
    expect(
      await t.withIdentity(identity("stranger@x.com")).run((ctx) => getMyMembership(ctx)),
    ).toBeNull();
  });

  test("returns the member object for a listed email", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, "ops@x.com", "member");
    expect(
      await t.withIdentity(identity("Ops@x.com")).run((ctx) => getMyMembership(ctx)),
    ).toEqual({ email: "ops@x.com", role: "member" });
  });

  test("public myMembership query wraps getMyMembership", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, "ops@x.com", "member");
    expect(await t.query(api.marketing.access.myMembership, {})).toBeNull();
    expect(
      await t.withIdentity(identity("ops@x.com")).query(api.marketing.access.myMembership, {}),
    ).toEqual({ email: "ops@x.com", role: "member" });
  });
});

describe("findMarketingMemberByEmail", () => {
  test("normalizes the email and returns null for unknown", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, "ops@x.com", "member");
    expect(await t.run((ctx) => findMarketingMemberByEmail(ctx, " OPS@x.com"))).toEqual({
      email: "ops@x.com",
      role: "member",
    });
    expect(await t.run((ctx) => findMarketingMemberByEmail(ctx, "unknown@x.com"))).toBeNull();
  });

  test("applies the bootstrap-admin rule without identity", async () => {
    const t = convexTest(schema, modules);
    expect(await t.run((ctx) => findMarketingMemberByEmail(ctx, "BOSS@agency.com"))).toEqual({
      email: BOOTSTRAP,
      role: "admin",
    });
  });
});

describe("marketing schema", () => {
  test("inserts into all five tables and by_client_firedAt filters by client and time", async () => {
    const t = convexTest(schema, modules);
    const t0 = 1_700_000_000_000;
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("marketingMembers", {
        email: "ops@x.com",
        role: "member",
        addedBy: BOOTSTRAP,
        addedAt: t0,
      });
      const clientA = await ctx.db.insert("marketingClients", {
        name: "Acme HVAC",
        category: "hvac",
        locations: [
          {
            id: "loc-1",
            label: "HQ",
            address: "1 Main St",
            city: "Austin",
            stateCode: "TX",
            lat: 30.27,
            lon: -97.74,
            serviceRadiusMiles: 25,
          },
        ],
        competitors: ["Cool Co"],
        keywords: ["ac repair"],
        accountManagerEmail: null,
        active: true,
        updatedAt: t0,
        updatedBy: BOOTSTRAP,
      });
      const clientB = await ctx.db.insert("marketingClients", {
        name: "Bee Roofing",
        category: "roofing",
        locations: [],
        competitors: [],
        keywords: [],
        accountManagerEmail: "am@agency.com",
        active: false,
        updatedAt: t0,
        updatedBy: BOOTSTRAP,
      });
      await ctx.db.insert("marketingAlertChannel", {
        kind: "slack",
        target: "envelope",
        updatedAt: t0,
      });
      await ctx.db.insert("clientAlertRules", {
        clientId: clientA,
        kind: "weather",
        enabled: true,
        params: { minSeverity: "watch" },
        createdAt: t0,
      });
      const event = (clientId: typeof clientA, firedAt: number, dedupKey: string) => ({
        dedupKey,
        clientId,
        kind: "mention" as const,
        title: `event ${dedupKey}`,
        url: null,
        severity: "info" as const,
        firedAt,
        delivered: false,
      });
      await ctx.db.insert("marketingAlertEvents", event(clientA, t0 - 1000, "a-old"));
      await ctx.db.insert("marketingAlertEvents", event(clientA, t0 + 1000, "a-new"));
      await ctx.db.insert("marketingAlertEvents", {
        ...event(clientB, t0 + 2000, "b-new"),
        url: "https://example.com",
        severity: "warning",
        delivered: true,
      });
      return { clientA };
    });

    const recent = await t.run((ctx) =>
      ctx.db
        .query("marketingAlertEvents")
        .withIndex("by_client_firedAt", (q) => q.eq("clientId", ids.clientA).gt("firedAt", t0))
        .collect(),
    );
    expect(recent.map((e) => e.dedupKey)).toEqual(["a-new"]);

    const byDedup = await t.run((ctx) =>
      ctx.db
        .query("marketingAlertEvents")
        .withIndex("by_dedup", (q) => q.eq("dedupKey", "b-new"))
        .collect(),
    );
    expect(byDedup).toHaveLength(1);

    const rules = await t.run((ctx) =>
      ctx.db
        .query("clientAlertRules")
        .withIndex("by_client", (q) => q.eq("clientId", ids.clientA))
        .collect(),
    );
    expect(rules).toHaveLength(1);
  });
});
