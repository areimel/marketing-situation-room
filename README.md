# Marketing Situation Room

Marketing Situation Room is a workspace for marketing agencies. Start with the local client roster, select an account, and read its briefing and signals together. The client is the unit of analysis throughout the dashboard.

## Run locally

Use the Node.js version in `.nvmrc` (Node 24). From the repository root, install dependencies and start Vite.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Both `/` and `/dashboard` open the agency workspace. For a static deployment, configure the host to serve the SPA entry document on direct requests to `/dashboard`.

## Working on the app

The agency browser code lives under `src/agency/`. See the [architecture guide](ARCHITECTURE.md) for the entry point, client data flow, and relationship to the marketing service contracts.

## License

The source is licensed under [AGPL-3.0-only](LICENSE).

Copyright (C) 2024-2026 Elie Habib. All rights reserved.
