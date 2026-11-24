# Security policy

Report issues in Marketing Situation Room privately to the [agency repository maintainer](https://github.com/areimel). Include the affected revision, component, expected behavior, and a reproduction using fictional client data. The supported branch is `main`.

## Client records

The browser stores client names, briefs, internal notes, and competitor observations in localStorage for the current origin and browser profile. A brief download contains the selected account’s name, the date, and its brief. The demo uses explicitly fictional companies and observations.

## Data sources and services

The public headline endpoint fetches one fixed Google News RSS query. It rejects redirects. The browser renders headline text and links to the feed provider. Client names and workspace contents stay out of feed requests.

Marketing RPCs use generated request validation and private no-store responses. Keep server credentials outside the repository. The separate Convex membership module uses verified identities for membership checks.
