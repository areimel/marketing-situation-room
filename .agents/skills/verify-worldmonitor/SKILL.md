---
name: verify-worldmonitor
description: Verify the agency workspace in Chromium, including client selection, brief persistence and headline states.
---

# Verify the marketing workspace

Use Node.js 24 and install dependencies with `npm ci`. Run `npm run test:e2e` from the repository root. Playwright starts the configured server. The agency checks live in `e2e/marketing-dashboard.spec.ts`.

For a UI change, exercise the changed interaction on desktop and mobile. Use fictional client data and a controlled response from `/api/agency-headlines` when capturing evidence. Record the commit, viewport, action and observed state. Report live provider availability separately when verified.
