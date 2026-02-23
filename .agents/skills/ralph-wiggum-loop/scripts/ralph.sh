#!/usr/bin/env bash
# Ralph Wiggum Loop — autonomous agent loop for Amp
# Based on https://github.com/snarktank/ralph
# Reference: https://github.com/ghuntley/how-to-ralph-wiggum
#
# Usage:
#   ./ralph.sh [max_iterations]        # Build mode (default), max 10
#   ./ralph.sh plan [max_iterations]   # Plan mode, max 3
#
# Modes:
#   build (default) — implements stories from prd.json, one per iteration
#   plan            — gap analysis: specs vs code, generates/updates prd.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

# Parse arguments: [plan] [max_iterations]
MODE="build"
if [[ "${1:-}" == "plan" ]]; then
  MODE="plan"
  MAX_ITERATIONS="${2:-3}"
elif [[ "${1:-}" =~ ^[0-9]+$ ]]; then
  MAX_ITERATIONS="$1"
else
  MAX_ITERATIONS="${1:-10}"
fi

# Select prompt file based on mode
if [[ "$MODE" == "plan" ]]; then
  PROMPT_FILE="$PROJECT_ROOT/prompt_plan.md"
else
  PROMPT_FILE="$PROJECT_ROOT/prompt.md"
fi

PRD_FILE="$PROJECT_ROOT/prd.json"

# Validate required files
if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Error: $(basename "$PROMPT_FILE") not found at $PROMPT_FILE"
  if [[ "$MODE" == "plan" ]]; then
    echo "Hint: create prompt_plan.md for planning mode (see SKILL.md)"
  fi
  exit 1
fi

if [[ "$MODE" == "build" && ! -f "$PRD_FILE" ]]; then
  echo "Error: prd.json not found at $PRD_FILE"
  echo "Hint: run in plan mode first: ./ralph.sh plan"
  exit 1
fi

# Archive previous run if branch changed
if [[ -f "$PRD_FILE" ]]; then
  LAST_BRANCH_FILE="$PROJECT_ROOT/.last-branch"
  CURRENT_BRANCH=$(grep -o '"branchName"[[:space:]]*:[[:space:]]*"[^"]*"' "$PRD_FILE" | head -1 | sed 's/.*"branchName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

  if [[ -f "$LAST_BRANCH_FILE" ]]; then
    LAST_BRANCH=$(cat "$LAST_BRANCH_FILE")
    if [[ "$LAST_BRANCH" != "$CURRENT_BRANCH" && -n "$LAST_BRANCH" ]]; then
      ARCHIVE_DIR="$PROJECT_ROOT/archive/$(date +%Y-%m-%d)-$(echo "$LAST_BRANCH" | sed 's|ralph/||')"
      echo "Branch changed from $LAST_BRANCH to $CURRENT_BRANCH"
      echo "Archiving previous run to $ARCHIVE_DIR"
      mkdir -p "$ARCHIVE_DIR"
      cp "$PRD_FILE" "$ARCHIVE_DIR/"
      [[ -f "$PROJECT_ROOT/progress.txt" ]] && cp "$PROJECT_ROOT/progress.txt" "$ARCHIVE_DIR/"
      > "$PROJECT_ROOT/progress.txt"
    fi
  fi
  echo "$CURRENT_BRANCH" > "$LAST_BRANCH_FILE"
else
  CURRENT_BRANCH="(no prd.json yet)"
fi

echo "============================================"
echo "  Ralph Wiggum Loop"
echo "  Mode: $MODE"
if [[ -f "$PRD_FILE" ]]; then
  echo "  Project: $(grep -o '"project"[[:space:]]*:[[:space:]]*"[^"]*"' "$PRD_FILE" | head -1 | sed 's/.*"project"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
fi
echo "  Branch: $CURRENT_BRANCH"
echo "  Prompt: $(basename "$PROMPT_FILE")"
echo "  Max iterations: $MAX_ITERATIONS"
echo "============================================"

for i in $(seq 1 "$MAX_ITERATIONS"); do
  echo ""
  echo "--- Ralph $MODE iteration $i of $MAX_ITERATIONS ---"
  echo ""

  OUTPUT=$(cat "$PROMPT_FILE" | amp --dangerously-allow-all 2>&1 | tee /dev/stderr) || true

  if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
    echo ""
    echo "============================================"
    echo "  Ralph completed all tasks!"
    echo "  Mode: $MODE"
    echo "  Total iterations: $i"
    echo "============================================"
    exit 0
  fi

  echo ""
  echo "--- Iteration $i complete ---"
  sleep 2
done

echo ""
echo "============================================"
echo "  Ralph reached max iterations ($MAX_ITERATIONS)"
echo "  Mode: $MODE"
echo "  Check progress.txt for details"
echo "============================================"
exit 1
