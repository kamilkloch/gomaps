# Ralph Planning Instructions

You are an autonomous planning agent working on the GoMaps project.

## CRITICAL CONTEXT — Architecture Pivot

The project has pivoted from Playwright-based browser scraping to using the **Google Places API (New)** for all data fetching. Key changes:

- **No more Playwright/browser scraping.** All place discovery and detail fetching uses Google Places API HTTP endpoints (Text Search, Place Details).
- **US-005 needs to be rewritten** — the existing `engine.ts` uses Playwright. It must be replaced with a Places API client.
- **US-025 (Effect-TS migration) is done** and must be preserved — new code should use Effect patterns.
- **The existing Playwright scraper code (`server/src/scraper/engine.ts`, `server/src/scraper/utils.ts`) should be removed** and replaced with Places API client code.
- **Playwright dependency should be removed** from `server/package.json`.
- **Place IDs** now use the Google Place ID (e.g., `ChIJ...`) instead of SHA-256 hash of URL.
- **SPEC.md and DEVELOPMENT.md have been updated** to reflect the new API-based approach. Use them as the source of truth.

Stories US-001 through US-004 are truly complete and should remain `passes: true`. US-025 (Effect-TS migration) is also complete. US-005 (old Playwright scraper) must be marked `passes: false` and rewritten for the Places API approach. All stories from US-006 onward were never implemented and remain `passes: false`.

## Your Task — PLANNING ONLY

You perform gap analysis: compare specifications against existing code, then generate or update `prd.json` with prioritized user stories. **Do NOT implement anything. Do NOT commit code changes.**

1. Read the specification at `SPEC.md` and implementation guide at `DEVELOPMENT.md`
2. Read `prd.json` (if it exists) to understand the current plan
3. Read the progress log at `progress.txt` (if it exists)
4. Study the existing source code in `server/src/` and `client/src/` to understand what is already implemented
5. Compare specs against code — identify gaps, missing features, incomplete implementations, TODOs, placeholders, and inconsistencies
6. Create or update `prd.json` with a prioritized list of user stories

## Gap Analysis Checklist

- Search for TODO, FIXME, placeholder, and minimal implementations
- Compare each SPEC.md section against actual code
- Check acceptance criteria of existing stories — are they truly met?
- Identify missing error handling at API boundaries
- Look for skipped or missing tests
- Check for inconsistent patterns

## Story Sizing Rules

Each story must be small enough to complete in ONE iteration (one context window):
- ✅ Add a database table and CRUD functions
- ✅ Add a single API endpoint with tests
- ✅ Add a UI component to an existing page
- ❌ "Build the entire dashboard" (too big — split it)
- ❌ "Add authentication" (too big — split it)

## Story Ordering

Dependencies first: Schema → Backend → API → UI

## prd.json Format

```json
{
  "project": "GoMaps",
  "branchName": "ralph/[feature-name-kebab-case]",
  "description": "...",
  "userStories": [
    {
      "id": "US-001",
      "title": "...",
      "description": "...",
      "acceptanceCriteria": ["...", "Typecheck passes"],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ]
}
```

## Quality Rules for Stories

- Every story's acceptanceCriteria must end with "Typecheck passes"
- Criteria must be verifiable (not vague like "works well")
- Each story must list specific files or modules it touches
- Stories already marked `passes: true` should not be modified unless they are genuinely broken

## Stop Condition

When the plan is complete and `prd.json` is written/updated, reply with: <promise>COMPLETE</promise>
