# E2E Interaction Coverage Checklist

This artifact maps currently implemented interactive UI controls to Playwright coverage paths.

| UI area | Interactive element | Covered by |
| --- | --- | --- |
| Global nav | `Projects`, `Shortlists`, `Settings` links + avatar | `ui-components.spec.ts` → `projects page supports mouse + keyboard create/open/delete flows`, `navigation links reach shortlists and settings placeholders` |
| Global nav + Routing | Active NavLink style (`font-weight: 700`, `color: #1a73e8`) while navigating between Projects and Explorer | `navigation-a11y.spec.ts` → `nav active styles and browser back-forward transitions remain correct` |
| Global nav + Routing | Browser history traversal (`Projects -> Setup -> Explorer`, then back/forward) restores expected pages | `navigation-a11y.spec.ts` → `nav active styles and browser back-forward transitions remain correct` |
| Global nav | Avatar badge renders with `U` label | `navigation-a11y.spec.ts` → `redirects and deep links resolve correctly for setup and explorer`, `nav active styles and browser back-forward transitions remain correct` |
| Routing | Bare `/setup` route redirects to `/projects` | `navigation-a11y.spec.ts` → `redirects and deep links resolve correctly for setup and explorer` |
| Routing | Bare `/explorer` route auto-selects first project when projects exist | `navigation-a11y.spec.ts` → `redirects and deep links resolve correctly for setup and explorer` |
| Routing | Invalid setup deep link (`/projects/nonexistent/setup`) shows deterministic not-found state | `navigation-a11y.spec.ts` → `redirects and deep links resolve correctly for setup and explorer` |
| Routing | Explorer deep link (`/projects/:id/explorer`) selects target project and loads places | `navigation-a11y.spec.ts` → `redirects and deep links resolve correctly for setup and explorer` |
| Projects | Empty-state `Create your first project` button | `ui-components.spec.ts` → `projects page supports mouse + keyboard create/open/delete flows` |
| Projects | Header `+ New Project` button | `ui-components.spec.ts` → `projects page supports mouse + keyboard create/open/delete flows` |
| Projects | Create form name input + submit (keyboard Enter + mouse click) | `ui-components.spec.ts` → `projects page supports mouse + keyboard create/open/delete flows` |
| Projects | Project card activation (keyboard Enter + Space) | `ui-components.spec.ts` → `projects page supports mouse + keyboard create/open/delete flows` |
| Projects | Delete action with dialog cancel + confirm | `ui-components.spec.ts` → `projects page supports mouse + keyboard create/open/delete flows` |
| Projects | Actionable API misrouting error banner on load + create failure (`Cannot /api/projects`) | `ui-components.spec.ts` → `projects page surfaces actionable API-routing errors when /api points to the wrong backend` |
| Projects + Accessibility | Landmark semantics: main region + projects list named region + project cards expose `role="button"` | `navigation-a11y.spec.ts` → `landmarks and keyboard-only explorer row selection are accessible` |
| Projects + Setup | Cross-view consistency: project status badge + summary metrics match Setup runs/progress for mixed completed/running history | `app-flows.spec.ts` → `projects and setup stay consistent for mixed run history and explicit run switching` |
| Setup | Map render + tile/canvas content assertion + drag pan (interactive mode) | `ui-components.spec.ts` → `setup page covers area, query, launch, runs, and pause controls`; `app-flows.spec.ts` setup scenarios |
| Setup | `Select Area` + coordinate pill updates | `ui-components.spec.ts` → `setup page covers area, query, launch, runs, and pause controls` |
| Setup | `Clear` selection + status copy | `ui-components.spec.ts` → `setup page covers area, query, launch, runs, and pause controls` |
| Setup | Query input keyboard editing | `ui-components.spec.ts` → `setup page covers area, query, launch, runs, and pause controls` |
| Setup | `Start Scrape` action | `ui-components.spec.ts` → `setup page covers area, query, launch, runs, and pause controls` |
| Setup | Run list selection context + `Pause` control | `ui-components.spec.ts` → `setup page covers area, query, launch, runs, and pause controls` |
| Setup | Run-scoped progress panel updates deterministically when switching historical/active runs | `app-flows.spec.ts` → `projects and setup stay consistent for mixed run history and explicit run switching` |
| Setup | Estimate badge shows `~N tiles · Est. M min` with area and fallback copy after clear | `setup-validation.spec.ts` → `estimate badge updates for selected area and resets after clear` |
| Setup | Empty query validation blocks scrape start and prevents `/api/scrape/start` call | `setup-validation.spec.ts` → `empty query blocks scrape start and shows validation without firing start request` |
| Setup | Start button disabled when no bounds are selected | `setup-validation.spec.ts` → `start scrape button stays disabled when no bounds are selected` |
| Setup | Breadcrumb chrome renders `Projects / {name} / Setup` | `setup-validation.spec.ts` → `breadcrumbs show Projects / project name / Setup` |
| Setup + Accessibility | Landmark semantics: setup page exposes `role="main"` and map panel named region | `navigation-a11y.spec.ts` → `landmarks and keyboard-only explorer row selection are accessible` |
| Setup | Previous Runs list is capped to 6 entries | `setup-validation.spec.ts` → `previous runs section renders at most 6 run entries even when more exist` |
| Setup | Bounds persistence round-trip across navigation (map select area -> Projects -> Setup restore) | `setup-validation.spec.ts` → `selected bounds persist across Projects -> Setup navigation round-trip` |
| Setup | Run status badge variants show matching status text + `setup-run-status-*` class for pending/running/paused/completed/failed | `setup-progress.spec.ts` → `run status badges render every status with matching class` |
| Setup | Running progress bar shows animated stripe class and ~50% width at halfway progress | `setup-progress.spec.ts` → `running progress bar shows animated 50% fill with elapsed and ETA stats` |
| Setup | Progress stats render elapsed + ETA (`Time: … · Est. remaining …`) from run telemetry | `setup-progress.spec.ts` → `running progress bar shows animated 50% fill with elapsed and ETA stats` |
| Setup | Pause/resume control transitions through in-flight and settled labels (`Pausing…`/`Resume`, `Resuming…`/`Pause`) | `setup-progress.spec.ts` → `pause/resume control toggles Pausing… -> Resume and Resuming… -> Pause` |
| Setup | SSE subscription updates progress counters in-place without route/navigation refresh | `setup-progress.spec.ts` → `SSE progress stream updates setup progress without navigation refresh` |
| Setup | Tile overlay state/color mapping (completed/running/pending/subdivided) is validated for interactive map mode | `setup-progress.spec.ts` → `tile overlay status colors are exposed for interactive map rendering` |
| Setup | Map diagnostic copy branches: API key error, map init timeout, tile load timeout | `setup-progress.spec.ts` → `map diagnostic copy covers API key error, init timeout, and tile timeout scenarios` |
| Setup + Explorer | Real scrape launched from Setup UI and reflected in Explorer table count | `live-scrape.spec.ts` → `setup UI launches live scrape and explorer reflects persisted results` |
| Setup + Backend | Legacy SQLite schema (`places.google_url`) auto-migration before real scrape writes | `live-scrape.spec.ts` → `migrates legacy places schema and persists scraped places`; `server/tests/db.test.ts` migration case |
| Explorer | Project selector dropdown | `ui-components.spec.ts` → `explorer exercises search, sort, filters, row selection, favorites, and virtualization` |
| Explorer | Header search input | `ui-components.spec.ts` → `explorer exercises search, sort, filters, row selection, favorites, and virtualization` |
| Explorer | `Filters` button | `ui-components.spec.ts` → `explorer exercises search, sort, filters, row selection, favorites, and virtualization` |
| Explorer | Table quick-filter + clear | `ui-components.spec.ts` → `explorer exercises search, sort, filters, row selection, favorites, and virtualization` |
| Explorer | All sortable headers (Name/Category/Rating/Reviews/Price/Website/Address) | `ui-components.spec.ts` → `explorer exercises search, sort, filters, row selection, favorites, and virtualization` |
| Explorer | Map render + tile/canvas content assertion | `ui-components.spec.ts` + `app-flows.spec.ts` explorer scenarios |
| Explorer | Row selection + detail panel sync | `ui-components.spec.ts` → `explorer exercises search, sort, filters, row selection, favorites, and virtualization` |
| Explorer + Accessibility | Landmark semantics: explorer page `role="main"` + named map/table regions | `navigation-a11y.spec.ts` → `landmarks and keyboard-only explorer row selection are accessible` |
| Explorer + Accessibility | Keyboard row navigation via `Tab` focus ring + `Enter` selection opens detail panel | `navigation-a11y.spec.ts` → `landmarks and keyboard-only explorer row selection are accessible` |
| Explorer | Favorite star toggle | `ui-components.spec.ts` → `explorer exercises search, sort, filters, row selection, favorites, and virtualization` |
| Explorer | Virtualized table scroll container | `ui-components.spec.ts` → `explorer exercises search, sort, filters, row selection, favorites, and virtualization` |
| Explorer | Map marker click -> table/detail sync (`data-selected=true` row + detail name) | `explorer-map-sync.spec.ts` → `map marker selection syncs table/detail and map click clears selection` |
| Explorer | Map click deselect clears active row and returns detail placeholder | `explorer-map-sync.spec.ts` → `map marker selection syncs table/detail and map click clears selection` |
| Explorer | Selection circle exists for selected place (interactive map mode) | `explorer-map-sync.spec.ts` → `map marker selection syncs table/detail and map click clears selection` |
| Explorer | Cluster markers expose grouped counts and numeric labels when zoomed out (interactive map mode) | `explorer-map-sync.spec.ts` → `cluster debug snapshot reports grouped marker clusters with numeric labels` |
| Explorer | Table quick-filter is table-only while global search filters both map markers and table; combined composition verified | `explorer-map-sync.spec.ts` → `table filter stays table-only while global search filters both map and table` |
| Explorer | Detail panel full-content rendering (name/category/rating/address/phone/website/amenities/photos/opening hours/scraped timestamp) | `explorer-detail.spec.ts` → `detail panel renders full seeded content` |
| Explorer | Fullscreen photo browser overlay (left thumbnail rail + right active image, next/previous controls, keyboard `ArrowLeft`/`ArrowRight`/`Escape`, and focus return) | `explorer-detail.spec.ts` → `fullscreen photo browser supports split layout, keyboard navigation, and focus return` |
| Explorer | Stale data indicator badge renders in table + detail panel for places older than stale threshold | `explorer-detail.spec.ts` → `stale indicators and stale-only filter honor configurable threshold` |
| Explorer | `Show stale only` checkbox + stale-threshold input filter table results with configurable day threshold | `explorer-detail.spec.ts` → `stale indicators and stale-only filter honor configurable threshold` |
| Explorer | Website type table badge classes (`direct`/`ota`/`social`) | `explorer-detail.spec.ts` → `website badge classes and price formatting render for all expected variants` |
| Explorer | Price-level formatting (`$`, `$$`, `$$$`, enum string, null) | `explorer-detail.spec.ts` → `website badge classes and price formatting render for all expected variants` |
| Explorer | Marker fill-color mapping by rating bands in interactive map mode | `explorer-detail.spec.ts` → `marker colors are derived from place ratings in interactive map mode` |
| Explorer | Empty project explorer state (`0 places`, no rows, placeholder detail panel) | `explorer-detail.spec.ts` → `empty project explorer renders zero-count state without rows` |
| Explorer | Bare `/explorer` route with no projects (`No projects` selector state) | `explorer-detail.spec.ts` → `bare explorer route without projects stays stable with empty selector` |
| Shortlists | Placeholder page route and content | `ui-components.spec.ts` → `navigation links reach shortlists and settings placeholders` |
| Settings | Placeholder page route and content | `ui-components.spec.ts` → `navigation links reach shortlists and settings placeholders` |

## Notes

- Some controls in SPEC-driven future stories are not yet implemented in the UI and are intentionally excluded from this checklist until those stories land.
- Map interactions degrade to fallback assertions when `VITE_GOOGLE_MAPS_API_KEY` is not configured.
