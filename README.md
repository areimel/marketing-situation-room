# Marketing Situation Room

Marketing Situation Room is a workspace for marketing agencies. Start with the local client roster, select an account, and work on its briefing alongside marketing industry headlines. The client is the unit of analysis throughout the dashboard.

## Run locally

Use the Node.js version in `.nvmrc` (Node 24). From the repository root, install dependencies and start Vite.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Both `/` and `/dashboard` open the agency workspace. For a static deployment, configure the host to serve the SPA entry document on direct requests to `/dashboard`.

## First visit

The first visit opens three labeled fictional clients with sample briefs and competitor observations. Choose a client to review its brief, or use **New client** for an agency account. The roster and selected account are saved in this browser. **Download brief** saves the selected client’s brief as a text file. Internal notes stay in the workspace. The Google News marketing feed is shared across clients. Use **Competitor evidence** to keep an observed change with its brand and source URL. Headlines use the shared agency feed endpoint and require network access.

## Working on the app

The agency browser code lives under `src/agency/`. See the [architecture guide](ARCHITECTURE.md) for the entry point, client data flow, and relationship to the marketing service contracts.

## License

The source is licensed under [AGPL-3.0-only](LICENSE).

Copyright (C) 2024-2026 Elie Habib. All rights reserved.
