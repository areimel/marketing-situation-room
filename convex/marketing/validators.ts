import { v } from "convex/values";
import { MARKETING_CATEGORIES, type MarketingSignalKind } from "../../shared/marketing/types";

export const marketingCategoryValidator = v.union(
  ...MARKETING_CATEGORIES.map((category) => v.literal(category)),
);

export const marketingClientLocationValidator = v.object({
  id: v.string(),
  label: v.string(),
  address: v.string(),
  city: v.string(),
  stateCode: v.string(),
  lat: v.number(),
  lon: v.number(),
  serviceRadiusMiles: v.number(),
});

const MARKETING_SIGNAL_KINDS = [
  "weather",
  "mention",
  "calendar",
  "trend",
] as const satisfies readonly MarketingSignalKind[];
// Compile-time guard: a kind added to MarketingSignalKind but missing above fails here.
const signalKindsComplete: Exclude<MarketingSignalKind, (typeof MARKETING_SIGNAL_KINDS)[number]> extends never
  ? true
  : false = true;
void signalKindsComplete;

export const marketingSignalKindValidator = v.union(
  ...MARKETING_SIGNAL_KINDS.map((kind) => v.literal(kind)),
);

export const marketingSeverityValidator = v.union(
  v.literal("info"),
  v.literal("watch"),
  v.literal("warning"),
);

export const marketingRoleValidator = v.union(v.literal("admin"), v.literal("member"));
