# Agency workspace architecture

## Browser entry

Vite serves the agency workspace as a single-page application. The root URL and `/dashboard` resolve to the same browser entry. A direct visit or refresh on either path must load the workspace. The agency interface belongs in `src/agency/`.

## Client context

[workspace.ts](src/agency/workspace.ts) assigns each new client a UUID. It saves the client name and current selection under the `agency.workspace.v1.` prefix in localStorage. If saving fails, the workspace reports the failure and keeps the roster in memory for the session.

[signals.ts](src/agency/signals.ts) requests Google News RSS through `/api/rss-proxy` with a fixed US marketing query covering the last seven days. All clients share the query. The renderer accepts up to six distinct links from the feed origin and displays separate messages for an empty result and an unavailable source. Its cleanup function aborts the request when the view is removed.

## Marketing service contracts

The repository also contains server contracts for four marketing datasets. These are separate from the local agency workflow. Their presence in the source tree does not establish that a dashboard signal came from a live provider.

| Operation | Response data |
| --- | --- |
| `listWeatherAlerts` | Weather alerts |
| `listCalendarEvents` | Calendar events |
| `searchLocalMentions` | Mentions matching a query |
| `getDemandTrends` | Demand trends and trending terms |

The [protobuf definitions](proto/worldmonitor/marketing/v1) define the wire format. The [browser adapter](src/services/marketing/api.ts) calls the generated client through `premiumFetch`. The [edge entry](api/marketing/v1/%5Brpc%5D.ts) registers generated routes with the shared gateway and dispatches to the [marketing handlers](server/worldmonitor/marketing/v1). At the rebuild checkpoint, these handlers return empty collections with `degraded: false`. An empty response cannot demonstrate the absence of real-world events.

## Membership

The [Convex membership module](convex/marketing/access.ts) resolves a signed-in user's verified email against the marketing membership table or configured bootstrap administrator. This is a server-side access mechanism. A client selected in the local roster is a viewing context and confers no permissions.
