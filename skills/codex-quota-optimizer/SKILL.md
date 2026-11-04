---
name: codex-quota-optimizer
description: Read OpenAI Codex 5-hour rolling usage limits (primary_window, 300m) and 7-day weekly usage limits (secondary_window, 10080m) from local session rollout logs or the ChatGPT Wham usage API, and dynamically optimize task execution, context reading, subagent spawning, and test scope to prevent HTTP 429 rate-limit lockouts mid-task. Trigger this skill at the start of any non-trivial task, before multi-file refactors, every 4 tool turns during long agentic loops, or whenever the user mentions usage limits, quota, 5-hour limit, weekly limit, or token conservation.
---

# Codex Quota Optimizer (`$codex-quota-optimizer`)

This skill gives you (**OpenAI Codex**) direct visibility into your own **5-hour rolling window (`primary_window`, 300 minutes)** and **7-day weekly limit (`secondary_window`, 10080 minutes)**—telemetry that `codex-core` writes to `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` on every turn for the TUI `/status` bar, but omits from your default tool context.

You MUST read your quota state and adapt how you execute work so you never crash mid-task with `HTTP 429 Too Many Requests` and leave the user's working tree in a broken state.

---

## Step 1: Read Your Current 5-Hour & Weekly Usage Limits

At the start of a task (before reading large files or spawning subagents) and every **4 tool turns** during long tasks, run the bundled quota inspection script from this skill's directory:

```bash
node "$(dirname "$0")/scripts/check_quota.mjs" --format=agent
```

*(If running from the repository root or `~/.codex/skills/codex-quota-optimizer`, invoke the path where this `SKILL.md` resides:)*

```bash
# Project-local or global skill location lookup:
SKILL_DIR="${CODEX_HOME:-$HOME/.codex}/skills/codex-quota-optimizer"
[ ! -d "$SKILL_DIR" ] && SKILL_DIR="./skills/codex-quota-optimizer"
node "$SKILL_DIR/scripts/check_quota.mjs" --format=agent
```

### How `check_quota.mjs` Works
1. **Local Rollout Log Tail (Zero Network Overhead)**: Scans `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` for the newest `event_msg` containing `payload.rate_limits` (`primary` 300-minute window and `secondary` 10080-minute weekly window).
2. **Live Backend Fallback (`--probe-remote`)**: If no recent rollout event exists (or if you pass `--probe-remote`), reads the bearer token from `~/.codex/auth.json` and queries `https://chatgpt.com/backend-api/wham/usage`.
3. **Output Schema**: Emits structured JSON containing:
   - `primary_window_5h`: `{ used_percent, remaining_effective_percent, resets_in_seconds, resets_in_human, burn_velocity_ratio }`
   - `secondary_window_weekly`: `{ used_percent, remaining_effective_percent, resets_in_seconds, resets_in_human, burn_velocity_ratio }`
   - `optimization_policy`: `{ mode, governing_window, max_file_read_lines, allow_subagents, test_strategy, mandatory_directives }`

---

## Step 2: Adapt Your Work Execution Based on `optimization_policy.mode`

You MUST obey the `mode` returned by `check_quota.mjs`. Do NOT execute a `NOMINAL` workflow when your 5-hour or weekly window is in `WARNING`, `CRITICAL`, or `RESERVE_STOP`.

### Mode A: `NOMINAL` (`5h used < 65%` AND `weekly used < 70%`)
- **Exploration**: You may use parallel `rg` searches, read full module files (up to 400 lines per view), and spawn subagents if needed.
- **Implementation**: Implement complete end-to-end solutions with thorough edge-case coverage.
- **Verification**: Run full unit and integration test suites after edits.
- **Heartbeat**: Re-run `check_quota.mjs` after 5 tool calls.

### Mode B: `WARNING_CONSERVE` (`5h used 65%–84%` OR `weekly used 70%–87%`)
Your 5-hour burst window or 7-day weekly pool is burning faster than linear time (`burn_velocity_ratio > 1.0`). Immediately switch to **Compact Surgical Execution**:
1. **Never Read Whole Files**: Use `rg -n "pattern" path/` to find exact line numbers first, then read only a `±30 line` slice (`sed -n 'Start,Endp' file`).
2. **Batch Edits**: Combine all changes to a file into a single patch/edit call rather than making iterative micro-edits across 4+ turns.
3. **No Subagents**: Do not spawn background/parallel subagents (`allow_subagents: false`); they multiply context headers across both the 5-hour and weekly pools.
4. **Targeted Verification Only**: Run tests strictly on the single modified test file (e.g., `npx tsx --test path/to/changed.test.ts | tail -n 25`) rather than the entire workspace suite. Always pipe verbose command output through `| head -n 40` or `| tail -n 30` so stdout does not bloat your conversation history.

### Mode C: `CRITICAL_SURGICAL` (`5h used 85%–94%` OR `weekly used 88%–94%`)
You are within 6%–15% of an immediate `HTTP 429` lockout. Switch to **Emergency Minimum-Token Execution**:
1. **Prioritize P0 Only**: If the user's prompt contains both a core bugfix/feature (P0) and secondary cleanup/refactoring/docs (P1/P2), execute ONLY the P0 changes now.
2. **Line-Slice Diffs Only**: Inspect at most `80 lines` per turn. Suppress all command stdout beyond 20 lines (`| tail -n 20`).
3. **Fast Static Check Over Heavy Test Suites**: Verify compilation/syntax with fast typecheckers (`tsc --noEmit` or syntax check) instead of launching browser/E2E runners.
4. **heartbeat Every 2 Turns**: Re-run `check_quota.mjs` every 2 tool turns.

### Mode D: `RESERVE_STOP` (`5h used >= 95%` OR `weekly used >= 95%`)
**STOP BEFORE HITTING HTTP 429.** Do not start a new multi-file edit that will fail halfway through.
1. Ensure all currently modified files are syntactically valid (no half-written blocks).
2. Write a concise `CODEX_CHECKPOINT.md` (or update the task summary) listing:
   - Completed changes.
   - Exact remaining steps.
   - Exact reset time from `primary_window_5h.resets_in_human` / `secondary_window_weekly.resets_in_human`.
3. Inform the user clearly that you paused at the 95% safety reserve so their working tree stays clean until the window resets.

---

## Step 3: Partition Multi-Step Tasks (`optimize_work_plan.mjs`)

When given a multi-step engineering task (e.g., 3+ subtasks or files to modify), pass your planned subtasks into `optimize_work_plan.mjs` to receive a quota-fitted execution schedule:

```bash
node "$SKILL_DIR/scripts/optimize_work_plan.mjs" \
  --tasks='[
    {"id":"1","title":"Fix auth token refresh bug","priority":"P0","est_5h_pct":8},
    {"id":"2","title":"Refactor session logger middleware","priority":"P1","est_5h_pct":12},
    {"id":"3","title":"Add integration test suite","priority":"P2","est_5h_pct":15}
  ]'
```

Follow the returned `schedule[].action` (`EXECUTE_FULL`, `EXECUTE_COMPACT`, `EXECUTE_MINIMAL`, or `DEFER_UNTIL_RESET`) for each subtask in order.

---

## Detailed Protocol & Token-Saving Playbooks

If you need concrete shell one-liners for low-token code navigation or details on how `RateLimitSnapshot` is encoded in `openai/codex`, read [`references/protocol_and_playbooks.md`](references/protocol_and_playbooks.md).
