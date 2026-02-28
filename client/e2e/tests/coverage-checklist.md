# E2E Interaction Coverage Checklist

This artifact maps currently implemented interactive UI controls to Playwright coverage paths.

| UI area | Interactive element | Covered by |
| --- | --- | --- |
| Projects | `+ New Project` button | `app-flows.spec.ts` → `project CRUD, setup navigation, and bounds persistence` |
| Projects | Create form name input + submit | `app-flows.spec.ts` → `project CRUD, setup navigation, and bounds persistence` |
| Projects | Project card click (open setup) | `app-flows.spec.ts` → `project CRUD, setup navigation, and bounds persistence` |
| Projects | Delete project action + confirm dialog | `app-flows.spec.ts` → `project CRUD, setup navigation, and bounds persistence` |
| Global nav | `Projects` navigation link | `app-flows.spec.ts` → `project CRUD, setup navigation, and bounds persistence` |
| Setup | Map render + pan (when API key exists) | `app-flows.spec.ts` → first + second tests |
| Setup | Area selection (`Select Area`) | `app-flows.spec.ts` → `project CRUD, setup navigation, and bounds persistence` |
| Setup | Progress panel and metrics rendering | `app-flows.spec.ts` → `setup page shows seeded run progress and tile metrics` |
| Explorer | Map render + pan (when API key exists) | `app-flows.spec.ts` → `explorer map, table filtering, and detail-panel selection` |
| Explorer | Table row selection + detail panel sync | `app-flows.spec.ts` → `explorer map, table filtering, and detail-panel selection` |
| Explorer | Header search input | `app-flows.spec.ts` → `explorer map, table filtering, and detail-panel selection` |
| Explorer | Table quick-filter input + clear button | `app-flows.spec.ts` → `explorer map, table filtering, and detail-panel selection` |
| Explorer | Sortable column header (`Rating`) | `app-flows.spec.ts` → `explorer map, table filtering, and detail-panel selection` |

## Notes

- Some controls in SPEC-driven future stories are not yet implemented in the UI and are intentionally excluded from this checklist until those stories land.
- Map interactions degrade to fallback assertions when `VITE_GOOGLE_MAPS_API_KEY` is not configured.
