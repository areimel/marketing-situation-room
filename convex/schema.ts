import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  marketingCategoryValidator,
  marketingClientLocationValidator,
  marketingRoleValidator,
  marketingSeverityValidator,
  marketingSignalKindValidator,
} from "./marketing/validators";

export default defineSchema({
  marketingMembers: defineTable({
    email: v.string(),
    role: marketingRoleValidator,
    addedBy: v.string(),
    addedAt: v.number(),
  }).index("by_email", ["email"]),

  marketingClients: defineTable({
    name: v.string(),
    category: marketingCategoryValidator,
    locations: v.array(marketingClientLocationValidator),
    competitors: v.array(v.string()),
    keywords: v.array(v.string()),
    accountManagerEmail: v.union(v.string(), v.null()),
    active: v.boolean(),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }),

  // Singleton. `target` is an encrypted Slack webhook envelope or an email list.
  marketingAlertChannel: defineTable({
    kind: v.union(v.literal("slack"), v.literal("email")),
    target: v.string(),
    updatedAt: v.number(),
  }),

  clientAlertRules: defineTable({
    clientId: v.id("marketingClients"),
    kind: marketingSignalKindValidator,
    enabled: v.boolean(),
    params: v.any(),
    createdAt: v.number(),
  }).index("by_client", ["clientId"]),

  marketingAlertEvents: defineTable({
    dedupKey: v.string(),
    clientId: v.id("marketingClients"),
    kind: marketingSignalKindValidator,
    title: v.string(),
    url: v.union(v.string(), v.null()),
    severity: marketingSeverityValidator,
    firedAt: v.number(),
    delivered: v.boolean(),
  })
    .index("by_dedup", ["dedupKey"])
    .index("by_client_firedAt", ["clientId", "firedAt"]),
});
