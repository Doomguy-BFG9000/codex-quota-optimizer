---
name: codex-quota-optimizer
version: 0.3.0
author: Thlookingatyou
repository: https://github.com/Thlookingatyou/codex-quota-optimizer
description: Read offline Codex 5-hour and weekly quota observations, classify XS-XL tasks, and schedule work while preserving a 95% ceiling. Missing or stale telemetry remains unknown.
---

# Codex Quota Optimizer

Use deterministic local scripts; no network, credentials, or extra model calls.

1. Read both quota windows before planning work:

```sh
node skills/codex-quota-optimizer/scripts/check_quota.mjs --task-size=M --format=agent
```

For an installed skill, substitute its directory. `CODEX_HOME` selects the telemetry directory. `--codex-home=` and `--rollout-file=` allow isolated fixture testing. Explicit overrides (`--5h=`, `--weekly=`) are manual simulations.

2. Classify the change and choose a model available in the current client. Project defaults, checked against [official OpenAI documentation](https://learn.chatgpt.com/docs/models?surface=cli) on November 5, 2026:

| Size | Scope | Model | Reasoning |
| --- | --- | --- | --- |
| XS | Typo, config, doc | gpt-6-luna | high |
| S | Isolated helper or bugfix | gpt-6-luna | high |
| M | Module feature/refactor | gpt-6.1-sol | medium |
| L | Cross-module change | gpt-6.1-sol | medium |
| XL | Architecture/deep debugging | gpt-6.1-sol | high |

These recommendations do not switch models or promise savings. Model and reasoning are separate settings. Use task complexity and supported options when adjusting effort.

3. Follow the reported mode:

- `NOMINAL`: inspect relevant modules, verify affected behavior; recheck every five turns.
- `WARNING_CONSERVE` (5h >=65% or weekly >=70%): focused reads up to 150 lines, sequential edits and affected tests.
- `CRITICAL_SURGICAL` (5h >=85% or weekly >=88%): focused reads up to 80 lines, prioritize blockers; record deferred verification.
- `RESERVE_STOP` (either window >=95%, or a stricter configured reserve): stop starting work and write `CODEX_CHECKPOINT.md` with remaining steps and known reset times.
- `TELEMETRY_UNKNOWN`: continue task sizing and necessary development using user instructions; do not claim quota headroom or quota-safe execution. The budget scheduler defers until both windows are known.

Observations older than 15 minutes, invalid timestamps, expired resets, wrong window durations, and missing values are unknown/stale. Never infer zero usage from a missing window or elapsed reset. Reset countdowns are aged from event time. A Pro/Enterprise label does not exempt a reported window.

4. For three or more deliverables, schedule tasks:

```sh
node skills/codex-quota-optimizer/scripts/optimize_work_plan.mjs --tasks='[{"title":"Fix parser","priority":"P0","est_5h_pct":6,"est_weekly_pct":2}]'
```

The scheduler checks rounded selected costs against both windows, defers work that exceeds the reserve, and records zero burn for deferred tasks. Estimates are illustrative; recheck telemetry between steps.

Locate symbols with `rg` before reading files, batch related edits, and verify syntax before affected tests. Run all checks explicitly requested by the user. Do not spawn subagents unless independently authorized.

See [protocol and playbooks](references/protocol_and_playbooks.md). The README documents CLI inputs, packaging, fixtures, and limitations.
