# Ralph Agent Instructions

You are an autonomous coding agent working on the GoMaps project.

## Your Task

1. Read the PRD at `prd.json`
2. Read the progress log at `progress.txt` (check Codebase Patterns section first)
3. Read the specification at `SPEC.md` and implementation guide at `DEVELOPMENT.md`
4. Check you're on the correct branch from PRD `branchName`. If not, check it out or create from main.
5. Pick the **highest priority** user story where `passes: false` (unfinished task with the lowest priority value (negative values are allowed) wins
6. Implement that single user story
7. Run mandatory quality gates (all must pass):
   - `npm run typecheck --workspace=server`
   - `npm run typecheck --workspace=client`
   - `npm test --workspace=server`
   - `npm test --workspace=client`
   - `npm run test:coverage` (must pass coverage thresholds in both workspaces)
8. If **any** quality gate fails, do **not** commit and do **not** set `passes: true`; fix issues and rerun all gates until green.
9. Update AGENTS.md files if you discover reusable patterns
10. Update the PRD to set `passes: true` for the completed story **only after all quality gates pass**
11. Append your progress to `progress.txt` and include the exact quality-gate commands you ran
12. Commit ALL changes with message: `feat: [Story ID] - [Story Title]`

## Progress Report Format

APPEND to progress.txt (never replace, always append):

```
## [Date/Time] - [Story ID]
Thread: https://ampcode.com/threads/$AMP_CURRENT_THREAD_ID
- What was implemented
- Files changed
- **Learnings for future iterations:**
  - Patterns discovered
  - Gotchas encountered
  - Useful context
---
```

## Consolidate Patterns

If you discover a **reusable pattern**, add it to the `## Codebase Patterns` section at the TOP of progress.txt. Only add patterns that are general and reusable.

## Quality Requirements

- ALL commits must pass server+client typecheck, server+client tests, and coverage thresholds
- Never mark a story as `passes: true` unless all required quality gates have passed in the current working tree state
- Do NOT commit broken code
- Keep changes focused and minimal
- Follow conventions in AGENTS.md
- Follow existing code patterns
- When a story changes `client/e2e/**`, `client/playwright.config.ts`, or Playwright-only UI hooks, run `npm run test:e2e --workspace=client` before marking it complete (the deterministic suite is mandatory; live scrape tests remain opt-in)

## Playwright Hard Requirements

- If a story touches Playwright tests, fixtures, utilities, or config, E2E TypeScript must be covered by the client typecheck in the current working tree state
- Do not use `waitForLoadState('networkidle')` as the default synchronization strategy on pages with Google Maps, SSE, or other background traffic; wait for explicit UI state, targeted responses, or deterministic debug hooks instead
- Shared locator helpers must preserve Playwright strictness; never use `.first()` or similar fallbacks to hide ambiguous matches in reusable helpers
- If a test relies on Playwright-only debug hooks or snapshots, missing hooks are test failures; do not catch and ignore the only assertion proving a map interaction happened
- Live or opt-in Playwright tests must not depend on host-only CLI tools or random port guessing when a repo-managed Node alternative can provide the same setup

## Stop Condition

After completing a user story, check if ALL stories have `passes: true`.
If ALL stories are complete, reply with: <promise>COMPLETE</promise>
If stories remain, end your response normally.

## Important

- Work on ONE story per iteration
- Commit frequently
- Keep CI green
- Read the Codebase Patterns section in progress.txt before starting
- Before making changes, search the codebase first (don't assume something is not implemented)
