# Marketing Situation Room — `marketing` variant design + build plan

## Context
- **Starting point:** the fork (`areimel/marketing-situation-room`, branch `initial-marketing-rework`) is a fresh WorldMonitor clone with **no marketing work yet**.
- **Why "Choose Workspace" has no Marketing option:** it lists *mission presets* (`MISSION_PRESETS`, `src/services/mission-presets.ts:55`), not variants, and none of them is marketing.
- **Goal:** turn this fork into an internal **marketing intelligence room for an agency serving local and regional SMB clients**, built as a new full site variant called `marketing`.
- **Size:** this is a project-sized change, so the design below is followed by an execution plan.

## Design (decisions are the user's unless marked *my call*)

### Intent
- **Who uses it:** account managers and the agency team, for three jobs:
  - **Overview:** a wall screen or morning standup showing all clients.
  - **Client focus:** drill into one client, or "my clients".
  - **Alerts:** something fires and someone acts on it.
- **Question it answers:** *"What is happening in each client's local market right now that we should react to?"* A reaction could be a post, an offer, a budget change or a heads-up to the client.

### Decided
- **Full variant `marketing`**, added next to the existing variants, with **upstream WorldMonitor sync kept**.
  - Changes are additive. Geopolitics, military and markets panels and layers are hidden in this variant, not deleted.
  - Template: the `commodity` variant (standard dark theme).
- **Internal tool, self-hosted on the agency's server**, built on the repo's existing `docker-compose.yml`.
  - The stack is `worldmonitor` (app), `redis` and `redis-rest`, plus a new **`notification-relay`** service built from `scripts/notification-relay.cjs`.
  - The same compose file runs on the dev machine for local work.
  - *My call:* Convex and Clerk stay hosted SaaS on the agency's own free-tier accounts, because self-hosting Convex is a later option. Resend handles email on its free tier, from the agency's own sender domain.
- **Marketing-only deployment.**
  - One deploy-wide env flag (e.g. `MARKETING_DEPLOY=1`) makes `marketing` the only variant served.
  - The same flag turns off Pro gates for allowlisted members, server-side. That covers `src/shared/premium-paths.ts`, the gateway, `assertProEntitlement` in `convex/alertRules.ts` and `convex/notificationChannels.ts`, and the relay's Pro filter at `scripts/notification-relay.cjs:1619`.
  - Without the flag, nothing changes for other variants or upstream.
  - Sign-in is required.
- **Access (*my call*):**
  - A Convex `members` table forms the allowlist. A bootstrap admin email is set by env var.
  - The admin adds and removes members in the app.
  - A signed-in user who isn't on the allowlist sees a "request access" screen.
- **Shared, sign-in-gated client roster in Convex, held in one agency workspace.**
  - Each client has: name, locations (address, lat/long, service-area radius), service category, competitors, watch keywords, and assigned account manager.
  - Any team member can view and edit it. *My call:* no per-client permissions.
  - The roster must **never** be in the build bundle or behind a public endpoint.
- **Public signals only** at launch, from **free sources only**. **US-first** (*my call*, because NWS is free and allows commercial use).
- **Map-first layout:** a large map on the left, AI Brief and Alerts on the right, and a row below with Local Mentions, Calendar, Search Trends and Industry News.

### Signals (all four in scope)
| Signal | Free source | Shape |
|---|---|---|
| Local news and mentions | Google News RSS searches per client (client name, competitors, "category + city"); GDELT GEO for map dots | Mentions panel grouped by client. `MonitorPanel.ts` only does browser-side keyword matching from localStorage, so per-client matching is new server work |
| Weather and local events | NWS `api.weather.gov/alerts/active` (needs a User-Agent); Nager.Date US holidays; a curated marketing-observances JSON in `shared/` (e.g. Small Business Saturday, National Pizza Day) tagged by category | Storm polygons on the map; a Calendar panel filtered by client category |
| Search and demand trends | Google "trending now" RSS (US and state level), plus Wikipedia pageviews for each category's articles as a seasonal demand proxy | Demand Trends panel showing per-category sparklines; Trends API alpha is a later upgrade |
| Industry and platform news | Trade RSS (e.g. Search Engine Land/Roundtable, Google Search Central and Ads blogs, Meta newsroom, MarTech, Social Media Today, Marketing Dive, local-SEO blogs) | News panels, plus the AI Brief (`InsightsPanel`) with a marketing branch in the summary and classifier prompts |

### Alerts
- **Rules are set per client.** Examples:
  - an NWS warning that intersects the service area
  - a mention of the client or a competitor
  - a category-relevant holiday within N days
- **Recipients:** each alert goes to **one shared agency channel**, a Slack webhook or an email list, configured once per workspace. Alerts also appear in the Alerts panel.
- **Delivery:** reuses the relay (Redis queue `wm:events:queue` → `notification-relay`) and its Slack-webhook and Resend senders.
  - The existing `alertRules` schema is per-user and filters by country, event type and ticker, so it **can't be reused as-is**.
  - Add a workspace-scoped `clientAlertRules` table instead, and teach the relay to send to the shared channel.
- **Timing (*my call*):**
  - NWS warnings and client or competitor mentions send in real time.
  - Holidays and trends go into a daily morning digest.
  - Deduplicate by client, signal and source item.

### Non-goals
- Client account data (GBP, GA4, Search Console, Ads) and anything paid.
- Stocks, SEC filings and prediction markets.
- Multiple agencies, billing, per-client permissions.
- Weather outside the US.

### Anti-goals (a failure even if it works)
- Client names leak publicly.
- Other variants break, or upstream merges become painful.
- The local dashboard comes up blank with no explanation. Dev fixtures or seed instructions are required.
- Alerts become noisy spam. Deduplicate them and keep thresholds conservative.

### Left to the builder
- Proto domain vs. RPC placement (prefer request-time `cachedFetchJson` handlers over Railway seeds).
- Geocoding provider (the free US Census geocoder is suggested).
- Exact feed list.
- Where the alert evaluator runs.
- i18n coverage (English first, with fallbacks).
- How work is split into PRs.

## Execution plan (parallel workstreams)
**Workflow:**
- First, commit this design as `docs/superpowers/specs/2026-10-21-marketing-variant-design.md`.
- Then run `superpowers:writing-plans` to produce the detailed task plan.
- Then execute with `superpowers:subagent-driven-development`, one git worktree per workstream, up to about 10 agents running at once.

**W0 Foundation (serial; everything else waits on it).** Register the `marketing` variant everywhere the variant mapping found it:
- **Variant config:** `src/config/variant.ts`, `variant-meta.ts`, `variant-dashboard-html.ts`, `variant-seo-summaries.ts`.
- **Panels and layers:** `panels.ts` (`MARKETING_PANELS`, `*_MAP_LAYERS`, `VARIANT_DEFAULTS`), `map-layer-definitions.ts`.
- **Routing and shell:** `middleware.ts` `VARIANT_HOST_MAP`, the `index.html` prepaint script, `src/app/panel-layout.ts` switcher.
- **Packaging:** `api/download.js`, the `package.json` scripts `dev:marketing` and `build:marketing`, `public/favico/marketing/`.
- **Tests:** about 20 tests that list variants (e.g. `tests/panel-variant-config*`, `tests/desktop-one-binary-model.test.mjs`).
- **New shared contract:** a `MarketingClient` type in `shared/`, plus a fixture roster with fake clients that other workstreams build against before W2 is ready.
- **Presets:** marketing mission presets ("Agency Overview", "Client Focus", "Storm Watch") in `mission-presets.ts`.

**Then, in parallel:**
- **W1 Feeds and AI Brief:**
  - Add `MARKETING_FEEDS` in `src/config/feeds.ts`, mirrored in `server/worldmonitor/news/v1/_feeds.ts` (`tests/feeds-client-server-parity.test.mjs` checks they match).
  - Add the feed domains to `shared/rss-allowed-domains.json` and give them source tiers.
  - Add a marketing branch to the prompts in `server/worldmonitor/news/v1/_shared.ts` and `_classifier.ts`.
- **W2 Workspace and roster:**
  - Convex tables for the workspace, members (email allowlist) and clients, with queries and mutations, tested in `convex/__tests__`.
  - Browser service `src/services/marketing/`.
  - A Roster panel for adding and editing clients, with geocoding.
- **W3 Client map and focus mode:**
  - Client pins and service-area circles in `DeckGLMap`.
  - The selected client lives in `AppContext` and is synced to the URL as `?client=` through `src/utils/urlState.ts`.
  - Selecting a client zooms the map to it and filters the panels.
- **W4 Weather alerts:**
  - An NWS alerts RPC using `cachedFetchJson`, with its `proto/` definition and `make generate`.
  - A storm-polygon map layer, and a panel filtered to clients' service areas.
- **W5 Calendar:** Nager.Date holidays plus the curated observances JSON, with category relevance; a Calendar panel.
- **W6 Local mentions:**
  - A request-time handler for per-client Google News RSS searches. The cache key must include the query.
  - GDELT geo dots on the map.
  - A Mentions panel.
- **W7 Demand trends:** a handler for the trending-now RSS feed and Wikipedia pageviews; a Demand Trends panel.
- **W8 Alerts:**
  - A `clientAlertRules` table plus the shared-channel config, in Convex.
  - An evaluator that pushes onto `wm:events:queue`.
  - Relay changes for shared-channel sends, including the Pro bypass under `MARKETING_DEPLOY`.
  - An Alerts feed panel, with deduplication and the daily digest.
- **W9 Auth, gating and self-hosting:**
  - The `MARKETING_DEPLOY` flag (single variant, server-side Pro bypass for members).
  - The Clerk sign-in gate, the `members` allowlist and the request-access screen.
  - In `docker-compose.yml`, add a `notification-relay` service with its Dockerfile, and wire the app to `redis-rest`.
  - Write `docs/marketing-setup.md`. It covers the Convex, Clerk, Resend and Slack-webhook accounts and their env vars, `docker compose up` for both the server and the dev machine, and the dev fixtures and seed data.

**Delivery:** PRs go to the fork's `main`, following AGENTS.md: preflight first, and UI screenshots attached to each PR. Foundation is one PR, then one PR per workstream.

## Verification
- **Run it:** `npm run dev:marketing` loads the variant and shows the marketing presets in Choose Workspace. With fixture clients, the map shows pins, panels render, and choosing a client filters everything.
- **Other variants:** `npm run dev` and the other `dev:*` scripts still behave the same.
- **Checks:** run each workstream's own tests, plus `npm run typecheck`, `typecheck:api`, `lint`, `lint:boundaries`, `test:data`, `test:convex` and `git diff --check`, one at a time.
- **Privacy:** grep the built `dist/` for fixture client names and confirm none appear. Confirm the roster endpoints reject signed-out requests.
- **Self-host:** `docker compose up` brings up the app, Redis and the relay. A test alert (a fixture NWS warning crossing a fixture client's service area) arrives in the shared Slack webhook or email inbox.
