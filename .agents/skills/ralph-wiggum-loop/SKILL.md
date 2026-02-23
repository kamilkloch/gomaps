---
name: ralph-wiggum-loop
description: "Autonomous agent loop that implements PRD user stories one at a time with two modes: PLAN (gap analysis, generates prd.json) and BUILD (implements stories, commits). Use when asked to run ralph, start the loop, plan stories, or implement PRD stories autonomously."
---

# Ralph Wiggum Loop

An autonomous coding agent loop based on [Geoffrey Huntley's Ralph pattern](https://ghuntley.com/ralph/). Each iteration is a fresh context window. Memory persists via git history, `progress.txt`, and `prd.json`.

Reference: [The Ralph Playbook](https://github.com/ghuntley/how-to-ralph-wiggum)

## Two Modes, Two Prompts, One Loop

| Mode | Prompt file | When to use | What it does |
|------|-------------|-------------|--------------|
| **PLAN** | `prompt_plan.md` | No plan exists, or plan is stale/wrong | Gap analysis (specs vs code), generates/updates `prd.json`. No implementation, no commits. |
| **BUILD** | `prompt.md` | Plan exists in `prd.json` | Picks highest priority incomplete story, implements it, runs quality checks, commits, updates progress. |

### Why use the loop for both modes?

- **BUILD** requires it: many tasks × fresh context = isolation
- **PLAN** uses it for consistency: same execution model, though often completes in 1–2 iterations
- If the plan needs refinement, the loop allows multiple passes reading its own output
- One mechanism for everything; clean file I/O; easy stop/restart

## Running the Loop

```bash
# Build mode (default) — implement stories
.agents/skills/ralph-wiggum-loop/scripts/ralph.sh [max_iterations]

# Plan mode — gap analysis, generate/update prd.json
.agents/skills/ralph-wiggum-loop/scripts/ralph.sh plan [max_iterations]
```

Default: 10 iterations for build, 3 for plan.

## PLAN Mode Workflow

Each iteration:
1. Study `SPEC.md` and `DEVELOPMENT.md`
2. Study existing source code in `server/src/` and `client/src/`
3. Compare specs against code (gap analysis)
4. Create/update `prd.json` with prioritized, right-sized user stories
5. **No implementation, no commits**

## BUILD Mode Workflow

Each iteration:
1. Read `prd.json`
2. Read `progress.txt` (check **Codebase Patterns** section first)
3. Read `SPEC.md` and `DEVELOPMENT.md`
4. Check correct branch from PRD `branchName`
5. Pick highest priority story where `passes: false`
6. Implement that single story
7. Run quality checks: `npm run typecheck --workspace=server`, `npm run typecheck --workspace=client`, `npm test --workspace=server`
8. Update AGENTS.md if reusable patterns discovered
9. If checks pass, commit with: `feat: [Story ID] - [Story Title]`
10. Update `prd.json` to set `passes: true`
11. Append progress to `progress.txt`

## Progress Report Format

APPEND to `progress.txt` (never replace):

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

## Key Principles

### Fresh Context Each Iteration
Each iteration spawns a **new Amp instance** with clean context. The only memory between iterations is:
- Git history (commits from previous iterations)
- `progress.txt` (learnings and context)
- `prd.json` (which stories are done)

### The Plan Is Disposable
If the plan is wrong, throw it out and re-run in PLAN mode. Regeneration cost is one planning loop — cheap compared to Ralph going in circles.

### Backpressure Is Critical
Ralph only works if there are feedback loops: typecheck catches type errors, tests verify behavior. Broken code compounds across iterations.

### Move Outside the Loop
Your job is to sit *on* the loop, not *in* it. Watch for failure patterns, then add guardrails (prompt tweaks, AGENTS.md updates, codebase utilities) so they don't recur.

## Stop Condition

- **BUILD**: When all stories have `passes: true`, emit `<promise>COMPLETE</promise>`
- **PLAN**: When `prd.json` is written/updated, emit `<promise>COMPLETE</promise>`

## Important Rules

- Work on **ONE story per iteration** (build mode)
- Commit frequently, keep CI green
- Read Codebase Patterns in `progress.txt` before starting
- Search the codebase first — don't assume something is not implemented
