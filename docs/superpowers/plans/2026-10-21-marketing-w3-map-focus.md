# W3 Client Map + Focus Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every roster client on the marketing map as a pin with its service-area circles in miles, and let one client be "focused". Focusing syncs to `?client=`, flies the map to that client, and gives panels one signal they can filter on.

**Architecture:**
- `clients-layer.ts` returns one deck.gl `CompositeLayer` that renders two `ScatterplotLayer`s:
  - service areas, sized in meters from `serviceRadiusMiles`;
  - pins, sized in pixels.
- `focus.ts` stays the single source of truth for the focused id. It is seeded from the URL through `src/utils/urlState.ts`. The existing map URL writer (`buildMapUrl` via `EventHandlerManager.getShareUrl`) carries `client=` back out, so map moves never drop it.
- A small app-layer controller, `src/app/marketing-focus.ts`, joins the roster, focus, map and picker. On each focus change it pushes the clients and focus into the map context through W0's `MapContainer.setMarketingLayerContext(patch)` (Resolution 9), flies the camera, and resyncs the URL.

**Tech Stack:** TypeScript, deck.gl 9.4 (`@deck.gl/core` `CompositeLayer`, `@deck.gl/layers` `ScatterplotLayer`), maplibre via `MapContainer.setCenter`, node:test + tsx, vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-21-marketing-variant-design.md`. The binding contracts are in `docs/superpowers/plans/2026-10-21-marketing-00-index.md`.

## Global Constraints

- Every constraint in the index's "Global Constraints" applies here. In particular:
  - **Additive.** Output must be byte-for-byte unchanged when `VITE_VARIANT !== 'marketing'`.
  - **No client data in the bundle.**
  - **Browser import direction** is `types -> config -> services -> components -> app -> App.ts`.
  - **English copy** goes under `marketing.*` in `src/locales/en.json`.
- `?client=` carries only the opaque client id. It never carries a name, address or keyword, because names must not leak through shared links.
- Use the shared contracts exactly as the index names them: `MarketingClient`, `MarketingClientLocation`, `MarketingLayerContext`, `getFocusedClientId` / `setFocusedClientId` / `onFocusChange`, `getClients` / `subscribeClients`, layer id `marketingClients`, and `buildMarketingClientsLayer(ctx)`.
- Binding index resolutions this plan applies: 1 (locales), 9 (map context setter, `CompositeLayer`, per-layer tooltip), 12 (id format, inactive clients), 13 (focus events), 18 (shared empty-state key, roster status).
- Miles to meters: `1 mile = 1609.344 m`. One degree of latitude is `69.172` miles.
- Before implementing, run `npm run --silent agent:preflight -- --mode repair`. Run heavy suites one at a time.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Ownership (W3)

**Create:**
- `src/services/marketing/focus-viewport.ts`
- `src/app/marketing-focus.ts`
- `src/components/marketing/ClientFocusPicker.ts`
- the tests listed in each task

**Replace the W0 stub body of:**
- `src/services/marketing/focus.ts`
- `src/components/marketing/map/clients-layer.ts`

**Additive, marketing-gated edits to shared files.** No other workstream owns these. Keep each edit to the lines named:
- `src/utils/urlState.ts`
- `src/app/event-handlers.ts` (`getShareUrl`)
- `src/App.ts` (Phase 5 deep-link capture)
- `src/app/panel-layout.ts` (one mount span in the header)
- `src/locales/en.json` (`marketing.focus.*`), plus the English fallbacks that `npm run sync:locales` writes to the other `src/locales/*.json` (Resolution 1)

**Consumed from W0, not created here:** `MapContainer.setMarketingLayerContext` (Resolution 9), `getRosterStatus` / `onRosterStatusChange` in `roster.ts` and the `marketing.empty.noClients` key (Resolution 18).

**Not touched:** any panel file under `src/components/marketing/` other than the picker. Panels belong to W2 and W4–W8. They consume the API in "Consumer guide for panel owners" below.

## Review Focus

1. **A location with `NaN`, out-of-range or missing lat/lon, or a radius ≤ 0 or non-finite.**
   - Expected: that location gets no pin and no circle, and it is left out of the viewport. A client left with zero valid locations is skipped entirely, and focusing it does not move the camera. Nothing throws.
   - Pinned in Task 3 (`skips invalid locations`) and Task 4 (`returns null when no valid location`).
2. **A stale or deleted `?client=` id in a shared link.**
   - Expected: once the roster loads (`getRosterStatus() === 'ready'`), the focus is cleared and the next URL write drops `client=`. Panels see `null`, not a ghost filter. While the roster is `loading`, `forbidden` or `error`, focus is kept, so a slow load never wipes a valid deep link.
   - Pinned in Task 4 (`clears focus when the id is not in the roster`, `keeps focus while the roster is not ready`).
3. **A malformed `?client=`**, for example `<script>`, a 500-character string or an empty value.
   - Expected: it is ignored and parses as undefined.
   - Pinned in Task 1 (`rejects malformed client ids`).
4. **Empty roster.**
   - Expected: the picker shows only `marketing.empty.noClients` (the shared W0 key) and is disabled, the clients layer returns `null`, and there is no error.
   - Pinned in Task 3 (`returns null for an empty roster`) and Task 5 (`renders the empty state`).
5. **A shared deep link that has both a camera (`lat/lon/zoom`) and `client=`.**
   - Expected: the URL camera wins on boot. Only a later user focus change flies the map, and re-selecting the focused client does nothing.
   - Pinned in Task 2 (`setFocusedClientId with the same id does not notify`) and Task 4 (`does not fly for the URL-seeded focus`).

---

### Task 1: `client` URL param in `urlState.ts`

**Files:**
- Modify: `src/utils/urlState.ts`:
  - `ParsedMapUrlState`, lines 47-57
  - `parseMapUrlState`, lines 121-185
  - `buildMapUrl`, lines 187-235
- Test: `tests/urlState.test.mts` (append `describe` blocks)

**Interfaces:**
- Produces:
  - `ParsedMapUrlState.client?: string`
  - `buildMapUrl(baseUrl, state)`, whose `state` gains `client?: string`
  - `export const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/` (the Convex-id format fixed by Resolution 12)
  - `export function readFocusedClientParam(search: string): string | null`

- [ ] **Step 1: Write the failing tests.** Add them to `tests/urlState.test.mts` and import `readFocusedClientParam` from `../src/utils/urlState.ts`:

```ts
describe('client focus param', () => {
  it('parses a valid client id', () => {
    assert.equal(parseMapUrlState('?client=k17abc_9-Z', EMPTY_LAYERS).client, 'k17abc_9-Z');
    assert.equal(readFocusedClientParam('?client=k17abc_9-Z'), 'k17abc_9-Z');
  });
  it('rejects malformed client ids', () => {
    for (const bad of ['', '%3Cscript%3E', 'a b', 'x'.repeat(65), 'a.b']) {
      assert.equal(parseMapUrlState(`?client=${bad}`, EMPTY_LAYERS).client, undefined);
      assert.equal(readFocusedClientParam(`?client=${bad}`), null);
    }
  });
  it('buildMapUrl emits client only when set', () => {
    const base = { view: 'global', zoom: 3, timeRange: '24h', layers: EMPTY_LAYERS } as const;
    assert.equal(new URL(buildMapUrl('https://x.test/', { ...base, client: 'c1' })).searchParams.get('client'), 'c1');
    assert.equal(buildMapUrl('https://x.test/', base), buildMapUrl('https://x.test/', { ...base, client: undefined }));
    assert.ok(!buildMapUrl('https://x.test/', base).includes('client='));
  });
  it('round-trips client', () => {
    const url = buildMapUrl('https://x.test/', { view: 'america', zoom: 5, timeRange: '7d', layers: EMPTY_LAYERS, client: 'c1' });
    assert.equal(parseMapUrlState(new URL(url).search, EMPTY_LAYERS).client, 'c1');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --import tsx --test tests/urlState.test.mts`
  - Expected: FAIL. `readFocusedClientParam` is not exported, and `client` is undefined.

- [ ] **Step 3: Implement the param.**
  - Trim the raw value, then test it against `CLIENT_ID_PATTERN`. Keep the case as given, because Convex ids are case-sensitive.
  - In `buildMapUrl`, `params.set('client', state.client)` goes last, after `chokepoint`, and runs only when `state.client` is truthy. That keeps every existing URL byte-identical.

- [ ] **Step 4: Run the tests and confirm they pass.**
  - Run: `node --import tsx --test tests/urlState.test.mts`
  - Expected: PASS, including every pre-existing case.

- [ ] **Step 5: Commit.**

```bash
git add src/utils/urlState.ts tests/urlState.test.mts
git commit -m "feat(marketing): add client focus param to map URL state"
```

### Task 2: Focus service: URL seed, no-op on the same id, panel filter helper

**Files:**
- Modify: `src/services/marketing/focus.ts` (replace the W0 in-memory body; keep its three exports)
- Test: `tests/marketing-focus.test.mts`

**Interfaces:**
- Consumes `readFocusedClientParam(search)` and `CLIENT_ID_PATTERN` from `@/utils/urlState` (Task 1).
- Produces the contract exports, unchanged:
  - `getFocusedClientId(): string | null`
  - `setFocusedClientId(id: string | null): void`
  - `onFocusChange(cb: (id: string | null) => void): () => void`
- Produces these additions:
  - `initFocusFromUrl(search: string): void`. It seeds the id silently and notifies no listeners.
  - `filterByFocusedClient<T extends { clientId: string | null }>(items: readonly T[], focusedId: string | null): T[]`
  - `__resetFocusForTests(): void`
- Semantics (Resolution 13):
  - `onFocusChange` does **not** fire on subscribe.
  - `setFocusedClientId` ignores an invalid id. It treats the id as `null` and still notifies, but only if the current value is non-null.
  - Setting the current value again is a no-op.
  - A listener that throws does not stop the other listeners.
  - An id that is well-formed but not in the roster ("unknown") is cleared by the controller in Task 4, which is the only module that sees the roster.

- [ ] **Step 1: Write the failing tests** in `tests/marketing-focus.test.mts`. Use `node:test` and `assert/strict`, and call `__resetFocusForTests()` in `beforeEach`.
  - `initFocusFromUrl seeds without notifying`: `initFocusFromUrl('?client=c1')` makes `getFocusedClientId()` return `'c1'` and the listener call count `0`.
  - `setFocusedClientId notifies subscribers once`: `set('c2')` produces the listener calls `['c2']`, and `set(null)` makes them `['c2', null]`.
  - `setFocusedClientId with the same id does not notify`: calling `set('c2')` twice produces exactly 1 call.
  - `invalid id clears focus`: after `set('c1')`, `set('bad id')` makes `get()` return `null`.
  - `unsubscribe stops notifications`
  - `a throwing listener does not block others`
  - `filterByFocusedClient`: for `[{clientId:'a'},{clientId:'b'},{clientId:null}]`:
    - with `null`, all 3 items come back;
    - with `'a'`, the result is `[{clientId:'a'},{clientId:null}]`, because agency-wide items stay.

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --import tsx --test tests/marketing-focus.test.mts`
  - Expected: FAIL, because `initFocusFromUrl` is not exported.

- [ ] **Step 3: Implement the new exports** in `src/services/marketing/focus.ts`. Use a module-level `let focused: string | null` and a `Set` of listeners.

- [ ] **Step 4: Run the tests and confirm they pass.**
  - Run: `node --import tsx --test tests/marketing-focus.test.mts`
  - Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/services/marketing/focus.ts tests/marketing-focus.test.mts
git commit -m "feat(marketing): focus service URL seed and panel filter helper"
```

### Task 3: Clients map layer (pins and service-area circles in miles)

**Files:**
- Modify: `src/components/marketing/map/clients-layer.ts` (replace the W0 `return null` stub)
- Create: `src/services/marketing/focus-viewport.ts`, holding only `isValidClientLocation` for now. Task 4 adds the viewport. The rule lives in `services` so both layers can import it (components → services).
- Test: `tests/marketing-clients-layer.test.mts`

**Interfaces:**
- Consumes:
  - `MarketingLayerContext` from `src/components/marketing/map/index.ts` (W0). W3 reads only `clients`, `focusedClientId` and `visibleLayerIds`; `weatherAlerts`, `mentions` and `signals` (Resolution 9) belong to W4, W6 and W8.
  - `MarketingClient` from `shared/marketing/types.ts`
  - `setFocusedClientId` (Task 2)
  - `PickingInfo` from `@deck.gl/core`
- Produces:
  - `export function isValidClientLocation(loc: MarketingClientLocation): boolean`, in `focus-viewport.ts`
  - `export const MILES_TO_METERS = 1609.344`
  - `export interface ClientLocationDatum { clientId: string; clientName: string; locationId: string; position: [number, number]; radiusMeters: number; focused: boolean; dimmed: boolean }`
  - `export function toClientLocationData(clients: MarketingClient[], focusedClientId: string | null): ClientLocationDatum[]`
  - `export function getMarketingClientsTooltip(info: PickingInfo<ClientLocationDatum>): { text: string } | null`. It returns `{ text: clientName }` for a picked pin and `null` otherwise. It uses deck.gl's plain-text `text` form, never `html`, so a name cannot inject markup.
  - `export class MarketingClientsLayer extends CompositeLayer<{ data: ClientLocationDatum[]; getTooltip?: typeof getMarketingClientsTooltip }>`, with `static layerName = 'MarketingClientsLayer'`. Resolution 9 allows a `CompositeLayer` as the builder's single return value.
  - `export function buildMarketingClientsLayer(ctx: MarketingLayerContext): Layer | null`, which keeps the contract name and returns a layer with id `'marketingClients'` and `getTooltip: getMarketingClientsTooltip` (Resolution 9: each layer owner supplies its own tooltip on its layer; see new Contract Issue A)
- Rules:
  - **Valid location:** `Number.isFinite` lat in [-90, 90], lon in [-180, 180], and a finite radius > 0. A client with `active === false` is skipped (Resolution 12).
  - **Focus styling:** `dimmed` is `focusedClientId !== null && clientId !== focusedClientId`, and `focused` is `clientId === focusedClientId`.
  - **Sub-layer ids**, built through `getSubLayerProps`:
    - `service-areas`: radius in `'meters'`, `stroked` and `filled`. It renders only non-dimmed data, so when a client is focused only its circles show.
    - `pins`: radius in `'pixels'`, radius `6`, or `9` when focused, plus `pickable: true`.
  - **Colors** are RGBA constants in the file:
    - pin `[56,189,248,230]`
    - focused pin `[250,204,21,255]`
    - area fill `[56,189,248,28]`
    - area stroke `[56,189,248,160]`
    - dimmed pins use alpha `70`
  - **Pin click:** `onClick: (info) => { if (info.object) setFocusedClientId(info.object.clientId); return true; }`. It returns `true` to consume the pick, as the webcam layer does at `DeckGLMap.ts:2396`.
  - **Null cases:** return `null` when `!ctx.visibleLayerIds.has('marketingClients')` or when there are no valid data.

- [ ] **Step 1: Write the failing tests** in `tests/marketing-clients-layer.test.mts`. It is a node:test file, and `@deck.gl/layers` is importable under tsx (see `tests/scenario-map-state.test.mjs`). Build the clients inline and do not import `dev-fixtures.ts`.
  - `converts miles to meters`: one location with `serviceRadiusMiles: 25` gets `radiusMeters === 40233.6` and `position` `[lon, lat]`.
  - `skips invalid locations`: a client whose locations are `{lat: NaN}`, `{lat: 95}`, `{serviceRadiusMiles: 0}`, `{serviceRadiusMiles: Infinity}` and one valid location yields exactly 1 datum. A client with `locations: []` yields 0.
  - `skips inactive clients`
  - `marks focus and dims others`: with two clients and focus `'a'`, the data for `a` is `focused:true, dimmed:false` and the data for `b` is `dimmed:true`.
  - `returns null for an empty roster`, `returns null when the layer is hidden`, and `returns null when all locations are invalid`.
  - `builds a MarketingClientsLayer with id marketingClients`. Then `layer.renderLayers()` returns 2 layers:
    - the ids end with `service-areas` and `pins`;
    - the areas layer's `radiusUnits === 'meters'` and the pins layer's `radiusUnits === 'pixels'`;
    - with focus `'a'`, the areas layer's `data` holds only `a`'s locations.
  - `tooltip shows the client name as text`: `getMarketingClientsTooltip({ object: datum })` returns `{ text: datum.clientName }` with no `html` key; `{ object: undefined }` returns `null`. The built layer's `props.getTooltip` is that function.

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --import tsx --test tests/marketing-clients-layer.test.mts`
  - Expected: FAIL. `toClientLocationData` is not exported, or the stub returns `null`.

- [ ] **Step 3: Implement** the layer as specified in the Interfaces block. `renderLayers()` builds both sub-layers from `this.props.data` and uses only `this.props` and `this.getSubLayerProps`, so it runs without a deck context.

- [ ] **Step 4: Run the tests and confirm they pass.**
  - Run: `node --import tsx --test tests/marketing-clients-layer.test.mts`
  - Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/components/marketing/map/clients-layer.ts src/services/marketing/focus-viewport.ts tests/marketing-clients-layer.test.mts
git commit -m "feat(marketing): client pins and service-area circles map layer"
```

### Task 4: Focus viewport, focus controller, URL write-back and App wiring

**Files:**
- Create: `src/app/marketing-focus.ts`
- Modify: `src/services/marketing/focus-viewport.ts` (add `clientFocusViewport`)
- Modify:
  - `src/app/event-handlers.ts:1533-1549` (`getShareUrl`)
  - `src/App.ts:2974-2983` (Phase 5, between the deep-link capture and `this.eventHandlers.setupUrlStateSync()`)
- Test:
  - `tests/marketing-focus-viewport.test.mts`
  - `tests/dom/marketing-focus-controller.test.mts`

**Interfaces:**
- Consumes:
  - Task 2's exports, and Task 3's `isValidClientLocation` from `focus-viewport.ts`. Do not re-implement the validity rule.
  - `subscribeClients(cb)`, `getRosterStatus()` and `onRosterStatusChange(cb)` from `src/services/marketing/roster.ts` (W0 creates them, W2 makes them real; Resolution 18)
  - `MapContainer.setCenter(lat, lon, zoom?)` (`src/components/MapContainer.ts:1005`), which already queues while the renderer isn't ready
  - `MapContainer.setMarketingLayerContext(patch: Partial<MarketingLayerContext>): void`, built by W0 (Resolution 9). It merges the patch and triggers a rebuild. W3 does not add or modify it, and only ever sends the `clients` and `focusedClientId` keys.
- Produces:
  - `export function clientFocusViewport(client: MarketingClient): { lat: number; lon: number; zoom: number } | null`, in `focus-viewport.ts`
  - `export type MarketingFocusMap = Pick<MapContainer, 'setCenter' | 'setMarketingLayerContext'>`, so the controller's map type tracks W0's signature exactly (type-only import, app → components is allowed)
  - `export function initMarketingFocus(deps: { getMap(): MarketingFocusMap | null; syncUrlState(): void; pickerMount: HTMLElement | null }): () => void`, in `src/app/marketing-focus.ts`. It returns a disposer.

**Viewport algorithm.** The test pins these values.
1. Take the bounding box of all valid locations, each expanded by `r / 69.172` degrees of latitude and `r / (69.172 * cos(lat))` degrees of longitude.
2. The center is the midpoint of the box.
3. `span = max(lonSpan, latSpan / cos(midLatRad))`.
4. `zoom = clamp(Math.floor(Math.log2(360 / Math.max(span, 0.01))) + 1, 4, 13)`.
5. If there are no valid locations, return `null`.

- [ ] **Step 1: Write the failing viewport tests** in `tests/marketing-focus-viewport.test.mts`:
  - `single location centers on it`: `{lat: 40, lon: -105, serviceRadiusMiles: 25}` gives `lat` 40 (±1e-9), `lon` -105 (±1e-9) and `zoom === 9`.
  - `two distant locations zoom out`: Denver (39.74, -104.99, r=10) plus Chicago (41.88, -87.63, r=10) give a zoom ≤ 6 and a center lon between -105 and -87.
  - `returns null when no valid location`: `locations: []`, or every location having `NaN` coordinates.
  - `clamps zoom to 13 for a tiny radius`: `r = 0.1` gives `13`.

- [ ] **Step 2: Run the viewport tests and confirm they fail.**
  - Run: `node --import tsx --test tests/marketing-focus-viewport.test.mts`
  - Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement `clientFocusViewport`** in `src/services/marketing/focus-viewport.ts`, next to `isValidClientLocation`.

- [ ] **Step 4: Run the viewport and layer tests and confirm they pass.**
  - Run: `node --import tsx --test tests/marketing-focus-viewport.test.mts tests/marketing-clients-layer.test.mts`
  - Expected: PASS.

- [ ] **Step 5: Write the failing controller tests** in `tests/dom/marketing-focus-controller.test.mts`.
  - Setup:
    - Use vitest with `vi.mock('@/services/marketing/roster')`, so that `subscribeClients` captures its callback.
    - Use a fake map with `setCenter` and `setMarketingLayerContext` as `vi.fn()`.
    - `syncUrlState` is a `vi.fn()` and `pickerMount` is `null`.
    - Call `__resetFocusForTests()` before each test.
  - `pushes clients and focus into the map context`: after the roster callback fires with 2 clients, `setMarketingLayerContext` has been called with `{ clients, focusedClientId: null }`.
  - `flies to a newly focused client`: after `setFocusedClientId('a')`, `setCenter` receives `clientFocusViewport(a)`'s lat, lon and zoom, `syncUrlState` has been called once, and the context patch includes `focusedClientId: 'a'`.
  - `does not fly for the URL-seeded focus`: after `initFocusFromUrl('?client=a')`, `initMarketingFocus` and a roster callback, `setCenter` is not called.
  - `clears focus when the id is not in the roster`: with the mocked `getRosterStatus` returning `'ready'`, after `initFocusFromUrl('?client=gone')` and a roster callback with `[a]`, `getFocusedClientId()` returns `null` and `syncUrlState` has been called.
  - `keeps focus while the roster is not ready`: with `getRosterStatus` returning `'loading'` (then `'forbidden'`, then `'error'`), a roster callback with `[]` leaves `getFocusedClientId() === 'gone'`. A later `onRosterStatusChange('ready')` with roster `[a]` clears it.
  - `clears focus when the client becomes inactive` (Resolution 12)
  - `skips flying for a client with no valid location`: `setCenter` is not called, but the focus is kept.
  - `null map is tolerated`: when `getMap` returns `null`, a focus change does not throw.
  - `disposer unsubscribes`: after `dispose()`, a focus change causes no calls.

- [ ] **Step 6: Run the controller tests and confirm they fail.**
  - Run: `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-focus-controller.test.mts`
  - Expected: FAIL, because the module is not found.

- [ ] **Step 7: Implement `initMarketingFocus`** in `src/app/marketing-focus.ts`.
  - It subscribes to the roster, the roster status and focus.
  - It keeps the latest clients list.
  - It validates the focused id against the active clients on each roster update or status change, but only when `getRosterStatus() === 'ready'`.
  - When `pickerMount` is non-null, it mounts `ClientFocusPicker` (Task 5). Until Task 5 lands, guard the mount behind `pickerMount`.

- [ ] **Step 8: Wire the controller into the app.**
  - **`getShareUrl`:** add `client: SITE_VARIANT === 'marketing' ? (getFocusedClientId() ?? undefined) : undefined` to the `buildMapUrl` state.
  - **`App.ts`:** right after `this.pendingDeepLinkSearchQuery = …` add:
    - `if (SITE_VARIANT === 'marketing') initFocusFromUrl(window.location.search);`
    - after `this.eventHandlers.setupUrlStateSync();`, `if (SITE_VARIANT === 'marketing') this.marketingFocusDispose = initMarketingFocus({ getMap: () => this.state.map, syncUrlState: () => this.eventHandlers.syncUrlState(), pickerMount: document.getElementById('clientFocusMount') });`
  - **`destroy()`:** call `this.marketingFocusDispose?.()`.
  - Load `initMarketingFocus` with a dynamic `import('@/app/marketing-focus')` inside the gate, so other variants' bundles don't carry it.

- [ ] **Step 9: Run the tests, typecheck and boundary lint.**
  - Run each, one at a time:
    - `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-focus-controller.test.mts`
    - `node --import tsx --test tests/urlState.test.mts tests/url-sync-initial.test.mts`
    - `npm run typecheck`
    - `npm run lint:boundaries`
  - Expected: all PASS, with 0 boundary violations.

- [ ] **Step 10: Commit.**

```bash
git add src/services/marketing/focus-viewport.ts src/app/marketing-focus.ts src/app/event-handlers.ts src/App.ts tests/marketing-focus-viewport.test.mts tests/dom/marketing-focus-controller.test.mts
git commit -m "feat(marketing): fly to focused client and sync ?client= to the URL"
```

### Task 5: Client focus picker in the header

**Files:**
- Create: `src/components/marketing/ClientFocusPicker.ts`
- Modify:
  - `src/app/panel-layout.ts:1157`. Directly after `<span id="missionPresetMount" …></span>`, add `${SITE_VARIANT === 'marketing' ? '<span id="clientFocusMount" class="client-focus-mount"></span>' : ''}`.
  - `src/locales/en.json`: `marketing.focus.label` = "Client", `marketing.focus.allClients` = "All clients". The empty state reuses W0's `marketing.empty.noClients` (Resolution 18); do not add a `marketing.focus.noClients` key.
  - `src/locales/*.json`: English fallbacks written by `npm run sync:locales` (Resolution 1). Never hand-edit them.
- Test: `tests/dom/marketing-client-focus-picker.test.mts`

**Interfaces:**
- Consumes:
  - `getFocusedClientId`, `setFocusedClientId` and `onFocusChange` (Task 2)
  - `t` from `@/services/i18n`
- Produces:
  - `export class ClientFocusPicker { constructor(mount: HTMLElement); setClients(clients: MarketingClient[]): void; destroy(): void }`
  - The controller (Task 4) calls `setClients` on every roster update.
- Rules:
  - Build the DOM with `createElement` and `textContent` only, with no `innerHTML`, because the safe-html lint applies.
  - The `<select class="client-focus-select" aria-label=t('marketing.focus.label')>` contains:
    - first, the option `value=""` → `allClients`;
    - then the active clients, sorted by `name` with `localeCompare`, where each option's value is the id and its label is the name.
  - Select change → `setFocusedClientId(value || null)`.
  - An external focus change updates `select.value`.
  - **Empty roster:** the select shows a single disabled-state option, `t('marketing.empty.noClients')`, and `select.disabled = true`. The picker uses the key as option text; `renderNoClientsState()` returns panel HTML and does not fit a `<select>`.

- [ ] **Step 1: Write the failing tests** in `tests/dom/marketing-client-focus-picker.test.mts`. Use vitest with `initTestI18n()` from `./helpers/i18n.mts`.
  - `renders the empty state`: `setClients([])` gives one option whose text is `t('marketing.empty.noClients')`, and the select is disabled.
  - `lists active clients sorted by name after All clients`: given `Fixture Zeta`, `Fixture Alpha` and an inactive `Fixture Beta`, the option texts are `['All clients', 'Fixture Alpha', 'Fixture Zeta']`.
  - `selecting an option focuses the client`: dispatching `change` on value `'a'` makes `getFocusedClientId()` return `'a'`, and choosing `''` makes it `null`.
  - `reflects external focus changes`: `setFocusedClientId('z')` makes `select.value === 'z'`.
  - `escapes names`: a client named `<img src=x onerror=alert(1)>` renders as option text, and `mount.querySelector('img')` is `null`.
  - `destroy unsubscribes and removes the select`

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-client-focus-picker.test.mts`
  - Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement `ClientFocusPicker`.** Add minimal styling for `.client-focus-select` that matches `.region-select`, by reusing the class: `class="region-select client-focus-select"`. Then replace Task 4's mount guard with `new ClientFocusPicker(pickerMount)`.

- [ ] **Step 4: Sync locale fallbacks.**
  - Run: `npm run sync:locales`. If it flags zh-TW, also run `npm run locales:zh-tw`.
  - Expected: the other `src/locales/*.json` files gain the two `marketing.focus.*` keys in English. On a rebase conflict in a locale file, take the base version and re-run `sync:locales` (Resolution 1).

- [ ] **Step 5: Run the picker and controller tests and the lint.**
  - Run each, one at a time:
    - `npx vitest run --config vitest.dom.config.mts tests/dom/marketing-client-focus-picker.test.mts tests/dom/marketing-focus-controller.test.mts`
    - `npm run lint`
    - `npm run typecheck`
  - Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/components/marketing/ClientFocusPicker.ts src/app/panel-layout.ts src/app/marketing-focus.ts src/locales/ tests/dom/marketing-client-focus-picker.test.mts
git commit -m "feat(marketing): header client focus picker"
```

### Task 6: End-to-end verification, privacy check and PR

**Files:** none new. This task verifies only.

- [ ] **Step 1: Run the suites,** one at a time:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run lint:boundaries`
  - `npm run test:dom`
  - `npm run test:data`
  - `git diff --check`
  - Expected: all green.

- [ ] **Step 2: Check other variants are unchanged.**
  - Run: `node --import tsx --test tests/urlState.test.mts tests/url-sync-initial.test.mts tests/map-layer-initial-url-gate.test.mts`
  - Expected: PASS.
  - Then, under `npm run dev`, copy the share link and confirm it has no `client=`.

- [ ] **Step 3: Drive the app manually.** Load `.agents/skills/verify-worldmonitor/SKILL.md`, then run `npm run dev:marketing` with the dev fixtures. Confirm each of these:
  - the five `Fixture ` pins and their circles render;
  - picking a client in the header flies the map, shows only that client's circles, and adds `?client=<id>` to the address bar;
  - reloading keeps the focus and the URL camera;
  - picking "All clients" removes `client=`;
  - clicking a pin focuses it, and hovering a pin shows the client name tooltip;
  - `?client=nope` clears itself once the roster loads.

- [ ] **Step 4: Check privacy.**
  - Run: `VITE_VARIANT=marketing npm run build && grep -rl "Fixture " dist/ || echo clean`
  - Expected: `clean`.

- [ ] **Step 5: Capture screenshots** of the desktop overview, the desktop focused client, and the mobile header picker. Label each with the commit SHA.

- [ ] **Step 6: Open the PR.**
  - Refresh the base, push, then run `gh pr create --base main`.
  - Attach the screenshots with `gh pr edit <n> --attach '/abs/path.png#<state>'`.
  - The body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Consumer guide for panel owners (W2, W4–W8)

This section adds no tasks for W3. It fixes the pattern each panel follows so that focus filters consistently.

- Read the initial value with `getFocusedClientId()` in the constructor. `onFocusChange` does not fire on subscribe.
- Subscribe with `this.unsubFocus = onFocusChange((id) => this.render())`, and call `this.unsubFocus()` in `destroy()`.
- Filter with `filterByFocusedClient(items, getFocusedClientId())`. Items with `clientId: null` (agency-wide) stay visible.
- For request-driven panels such as mentions (W6), build the RPC request from the focused client only, or from all clients when the id is `null`. Requery on change.
- Never write the focus to `localStorage`. The URL (`?client=`) is the only persistence.

## Contract Issues (resolved)

1. **No contract for how map context is fed** -> Resolution 9. W0 builds `MapContainer.setMarketingLayerContext(patch: Partial<MarketingLayerContext>)`. W3 consumes it and no longer plans a fallback setter.
2. **One builder, two layers** -> Resolution 9. A builder may return a `CompositeLayer`, which is what Task 3 does. Resolution 9 also assigns the tooltip to each layer owner, which Task 3 now adds as `getMarketingClientsTooltip`.
3. **`onFocusChange` behaviour unspecified** -> Resolution 13. It doesn't fire on subscribe, the same id is a no-op, and an unknown id clears focus. Task 2 pins these, and Task 4 clears roster-unknown ids.
4. **No id format** -> Resolution 12. The id is the Convex document id matching `/^[A-Za-z0-9_-]{1,64}$/`, and fixtures use the same format. Task 1's `CLIENT_ID_PATTERN` uses it.
5. **Inactive clients unspecified** -> Resolution 12. They are hidden from the map and picker, and focus on one clears (Tasks 3, 4 and 5).

### New, unresolved

A. **How per-layer tooltips reach deck.gl.** In deck.gl, `getTooltip` is a `Deck` prop, not a layer prop. Resolution 9 says each owner provides `getTooltip` "on its layer", so W0's DeckGLMap must call `info.layer?.props.getTooltip?.(info)` from its own `Deck` `getTooltip` for marketing layers. deck.gl reports the top-level `CompositeLayer` as `info.layer` and the sub-layer as `info.sourceLayer`, so reading the prop from `info.layer` works. W3 sets the prop on `MarketingClientsLayer` (Task 3). W0 needs to confirm this dispatch exists in DeckGLMap's existing tooltip handler.
