---
name: codex-quota-optimizer
version: 0.3.0
author: Thlookingatyou
repository: https://github.com/Thlookingatyou/codex-quota-optimizer
description: Zero-friction quota optimizer for OpenAI Codex that combines XS–XL task complexity classification and layered verification with offline local reading of Codex's 5-hour rolling window (primary_window, 300m) and 7-day weekly limit (secondary_window, 10080m) from ~/.codex/sessions/**/rollout-*.jsonl. Zero extra model calls, zero network requests, and zero credential access.
---

# Codex Quota Optimizer (`$codex-quota-optimizer` v0.3.0)

This skill minimizes avoidable token burn and prevents mid-task `HTTP 429 Too Many Requests` lockouts in **OpenAI Codex** by combining two complementary signals:
1. **Task Complexity Classification (`XS` to `XL`)**: Matches the task's actual change surface to the minimum sufficient model and reasoning effort.
2. **Offline Dual-Window Telemetry (`5h` & `Weekly`)**: Reads `payload.rate_limits.primary` (`window_minutes: 300`) and `payload.rate_limits.secondary` (`window_minutes: 10080`) from local `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` logs written by `codex-core`.

---

## Core Design Principles (Zero-Friction & Auditable Security)

1. **Zero Extra Model Calls**: This skill uses deterministic local heuristics and never invokes secondary LLM calls.
2. **Zero Network Requests & Zero Credential Access**: Scripts are **100% offline and read-only**. They NEVER read `~/.codex/auth.json` and NEVER make outbound HTTP requests.
3. **Non-Blocking Execution**: This skill does not block normal development with rigid budget gates. Instead, it dynamically narrows context reading and verification scope as your 5-hour or weekly window tightens, only recommending a clean checkpoint handoff when usage reaches `>= 95%`.
4. **Graceful Telemetry Fallback**: If `~/.codex/sessions/` has no rollout logs (e.g., fresh install or ephemeral container), the optimizer seamlessly falls back to pure **XS–XL Task Complexity Sizing**.

---

## Step 1: Classify the Task (`XS`–`XL`) & Read Local Quota Telemetry

At the start of a task, classify its complexity (`XS`, `S`, `M`, `L`, or `XL`) and run `check_quota.mjs`:

```bash
SKILL_DIR="${CODEX_HOME:-$HOME/.codex}/skills/codex-quota-optimizer"
[ ! -d "$SKILL_DIR" ] && SKILL_DIR="./skills/codex-quota-optimizer"
node "$SKILL_DIR/scripts/check_quota.mjs" --task-size=M --format=agent
```

### Task Complexity Definitions (`XS` – `XL`)

| Size | Scope & Surface Area | Baseline Model & Reasoning (Nominal Quota) | Quota-Constrained Shift (`5h >= 65%` or `Weekly >= 70%`) |
| :--- | :--- | :--- | :--- |
| **`XS`** | Typo fix, config value, rename, single-function doc (`1 file`, `< 25 lines`) | `codex-mini-latest` · `reasoning_effort="low"` | `codex-mini-latest` · `reasoning_effort="minimal"` · Read `<= 60 lines` |
| **`S`** | Isolated bugfix, small helper, unit test addition (`1–2 files`, `< 80 lines`) | `gpt-5-codex` · `reasoning_effort="low"` | `codex-mini-latest` · `reasoning_effort="low"` · Read `<= 100 lines` |
| **`M`** | Standard feature or refactor across a module (`2–4 files`, `80–250 lines`) | `gpt-5-codex` · `reasoning_effort="medium"` | `gpt-5-codex` · `reasoning_effort="low"` · Read `<= 150 lines` |
| **`L`** | Cross-module feature, API + UI integration, schema migration (`5–8 files`) | `gpt-5-codex` · `reasoning_effort="medium"` / `"high"` | `gpt-5-codex` · `reasoning_effort="medium"` · Disable subagents |
| **`XL`** | Architectural redesign, deep concurrency/root-cause debugging (`8+ files`) | `gpt-5-codex` · `reasoning_effort="high"` | Decompose into `M`-sized phases; checkpoint after each phase |

---

## Step 2: Enforce Focused Context & Minimal Change Surfaces

Regardless of quota state, eliminate avoidable context bloat on every turn:

1. **Locate Before Reading (`rg` -> `sed`)**:
   - Do not dump entire large files into context just to find a symbol.
   - Run `rg -n "SymbolName" src/` first, then read only the relevant slice with `sed -n 'Start,Endp' file` (respecting `max_file_read_lines` from `check_quota.mjs`).
2. **Single-Pass Batched Edits**:
   - Plan all edits to a file before writing, and apply them in one contiguous patch rather than 4–5 incremental trial-and-error turns.
3. **Subagent Discipline**:
   - Only spawn parallel exploration subagents on `L`/`XL` tasks when `allow_subagents=true` (`NOMINAL` quota). When `5h >= 65%` or `weekly >= 70%`, run sequentially.

---

## Step 3: Layered Verification (Cheapest Signal First)

Never run an expensive full-repository test suite or browser E2E harness as your first check. Always verify in layers and stop at the earliest failing layer:

- **Layer 1 — Fast Static / Syntax Check (Always Run First)**:
  Run a targeted typecheck or syntax check on touched files and cap output:
  ```bash
  npx tsc --noEmit 2>&1 | head -n 25
  ```
- **Layer 2 — Targeted Unit Test (Default for `S`, `M`, `L` Tasks)**:
  Run only the unit test file corresponding to the modified module and truncate verbose passing logs:
  ```bash
  npx tsx --test path/to/changed.test.ts 2>&1 | tail -n 25
  ```
- **Layer 3 — Full Suite / Integration Verification (Gated)**:
  Run full workspace suites only on `L`/`XL` tasks when `optimization_policy.mode === "NOMINAL"` and Layers 1–2 have already passed. In `CRITICAL_SURGICAL` mode (`5h >= 85%` or `weekly >= 88%`), skip Layer 3 and note it for post-reset execution.

---

## Step 4: Multi-Step Work Plan Scheduling (`optimize_work_plan.mjs`)

For tasks with 3+ distinct deliverables, run `optimize_work_plan.mjs` to rank P0 blockers ahead of P1/P2 work and assign each step an execution tier (`EXECUTE_FULL`, `EXECUTE_COMPACT`, `EXECUTE_MINIMAL_DIFF`, or `DEFER_UNTIL_RESET`):

```bash
node "$SKILL_DIR/scripts/optimize_work_plan.mjs" \
  --tasks='[
    {"id":"1","title":"Fix P0 null pointer in parser","priority":"P0","size":"S","est_5h_pct":6},
    {"id":"2","title":"Update CLI flags and help text","priority":"P1","size":"M","est_5h_pct":10},
    {"id":"3","title":"Refactor legacy test fixtures","priority":"P2","size":"L","est_5h_pct":16}
  ]'
```

---

## References

For details on `openai/codex` `RateLimitSnapshot` JSONL encoding and low-token shell one-liners, see [`references/protocol_and_playbooks.md`](references/protocol_and_playbooks.md).
