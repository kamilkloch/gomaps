# E2E Interaction Coverage Checklist

This artifact maps currently implemented interactive UI controls to Playwright coverage paths.

| UI area | Interactive element | Covered by |
| --- | --- | --- |
| Global nav | `Projects`, `Shortlists`, `Settings` links + avatar | `ui-components.spec.ts` → `projects page supports mouse + keyboard create/open/delete flows`, `navigation links reach shortlists and settings placeholders` |
| Projects | Empty-state `Create your first project` button | `ui-components.spec.ts` → `projects page supports mouse + keyboard create/open/delete flows` |
| Projects | Header `+ New Project` button | `ui-components.spec.ts` → `projects page supports mouse + keyboard create/open/delete flows` |
| Projects | Create form name input + submit (keyboard Enter + mouse click) | `ui-components.spec.ts` → `projects page supports mouse + keyboard create/open/delete flows` |
| Projects | Project card activation (keyboard Enter + Space) | `ui-components.spec.ts` → `projects page supports mouse + keyboard create/open/delete flows` |
| Projects | Delete action with dialog cancel + confirm | `ui-components.spec.ts` → `projects page supports mouse + keyboard create/open/delete flows` |
| Projects | Actionable API misrouting error banner on load + create failure (`Cannot /api/projects`) | `ui-components.spec.ts` → `projects page surfaces actionable API-routing errors when /api points to the wrong backend` |
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
| Setup | Previous Runs list is capped to 6 entries | `setup-validation.spec.ts` → `previous runs section renders at most 6 run entries even when more exist` |
| Setup | Bounds persistence round-trip across navigation (map select area -> Projects -> Setup restore) | `setup-validation.spec.ts` → `selected bounds persist across Projects -> Setup navigation round-trip` |
| Setup + Explorer | Real scrape launched from Setup UI and reflected in Explorer table count | `live-scrape.spec.ts` → `setup UI launches live scrape and explorer reflects persisted results` |
| Setup + Backend | Legacy SQLite schema (`places.google_url`) auto-migration before real scrape writes | `live-scrape.spec.ts` → `migrates legacy places schema and persists scraped places`; `server/tests/db.test.ts` migration case |
| Explorer | Project selector dropdown | `ui-components.spec.ts` → `explorer exercises search, sort, filters, row selection, favorites, and virtualization` |
| Explorer | Header search input | `ui-components.spec.ts` → `explorer exercises search, sort, filters, row selection, favorites, and virtualization` |
| Explorer | `Filters` button | `ui-components.spec.ts` → `explorer exercises search, sort, filters, row selection, favorites, and virtualization` |
| Explorer | Table quick-filter + clear | `ui-components.spec.ts` → `explorer exercises search, sort, filters, row selection, favorites, and virtualization` |
| Explorer | All sortable headers (Name/Category/Rating/Reviews/Price/Website/Address) | `ui-components.spec.ts` → `explorer exercises search, sort, filters, row selection, favorites, and virtualization` |
| Explorer | Map render + tile/canvas content assertion | `ui-components.spec.ts` + `app-flows.spec.ts` explorer scenarios |
| Explorer | Row selection + detail panel sync | `ui-components.spec.ts` → `explorer exercises search, sort, filters, row selection, favorites, and virtualization` |
| Explorer | Favorite star toggle | `ui-components.spec.ts` → `explorer exercises search, sort, filters, row selection, favorites, and virtualization` |
| Explorer | Virtualized table scroll container | `ui-components.spec.ts` → `explorer exercises search, sort, filters, row selection, favorites, and virtualization` |
| Shortlists | Placeholder page route and content | `ui-components.spec.ts` → `navigation links reach shortlists and settings placeholders` |
| Settings | Placeholder page route and content | `ui-components.spec.ts` → `navigation links reach shortlists and settings placeholders` |

## Notes

- Some controls in SPEC-driven future stories are not yet implemented in the UI and are intentionally excluded from this checklist until those stories land.
- Map interactions degrade to fallback assertions when `VITE_GOOGLE_MAPS_API_KEY` is not configured.
