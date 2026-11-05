# AGENTS.md — OpenAI Codex Quota-Aware Execution Instructions

Always use the `$codex-quota-optimizer` skill (`skills/codex-quota-optimizer/SKILL.md` or `~/.codex/skills/codex-quota-optimizer/SKILL.md`) to read both the **5-hour rolling window (`primary_window`, 300m)** and the **7-day weekly limit (`secondary_window`, 10080m)** before planning or executing work.

## Mandatory Protocol for Every Codex Task

1. **Turn 1 Quota Check**:
   Before reading project files or spawning subagents, run:
   ```bash
   SKILL_DIR="${CODEX_HOME:-$HOME/.codex}/skills/codex-quota-optimizer"
   [ ! -d "$SKILL_DIR" ] && SKILL_DIR="./skills/codex-quota-optimizer"
   node "$SKILL_DIR/scripts/check_quota.mjs" --format=agent
   ```
2. **Multi-Step Work Plan Optimization**:
   If a task involves 3 or more subtasks or files, schedule them against your remaining 5-hour and weekly quotas first:
   ```bash
   node "$SKILL_DIR/scripts/optimize_work_plan.mjs" --tasks='[{"id":"1","title":"...","priority":"P0","est_5h_pct":10}]'
   ```
3. **Strict Execution Mode Enforcement**:
   - **`NOMINAL` (`5h < 65%` and `weekly < 70%`)**: Standard agentic loop, up to 400 lines per file read, full test suite runs. Re-check quota every 5 tool turns.
   - **`WARNING_CONSERVE` (`5h 65%–84%` or `weekly 70%–87%`)**: Disable subagents (`allow_subagents=false`). Locate symbols with `rg -n` and read `<= 150 lines` via `sed -n`. Batch edits per file into a single turn. Run only modified unit test files and pipe output through `| tail -n 30`. Re-check quota every 3 tool turns.
   - **`CRITICAL_SURGICAL` (`5h 85%–94%` or `weekly 88%–94%`)**: Execute P0 blockers only; defer P1/P2 cleanup. Read `<= 80 lines` per file. Verify via `tsc --noEmit 2>&1 | head -n 25` instead of full test suites. Re-check quota every 2 tool turns.
   - **`RESERVE_STOP` (`5h >= 95%` or `weekly >= 95%`)**: Stop before triggering `HTTP 429 Too Many Requests`. Leave all edited files syntactically valid, write `CODEX_CHECKPOINT.md` with exact remaining steps and reset countdowns, and exit cleanly.

## Telemetry uncertainty

Run `TELEMETRY_UNKNOWN` as task-sizing guidance only. Missing or stale observations do not authorize claiming nominal quota or numerical headroom. The scheduler defers budgeted work until both windows are known. Continue user-authorized development and explicitly requested verification; report uncertainty. A known reserve stop still governs a missing other window. Reported limits apply to every plan.
