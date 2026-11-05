# Changelog

All notable changes to **`Thlookingatyou/codex-quota-optimizer`** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.0] - 2026-11-04

### Added
- **XS–XL Task Complexity Classification (`--task-size=XS|S|M|L|XL`)**: Combined static task complexity sizing (`XS`, `S`, `M`, `L`, `XL`) with live local 5-hour (`300m`) and weekly (`10080m`) quota telemetry so trivial tasks (`XS`/`S`) never waste `reasoning_effort="high"` tokens even when quota is nominal.
- **3-Stage Layered Verification Protocol**: Standardized verification into Layer 1 (fast static typecheck/syntax on modified files), Layer 2 (single modified unit test file with truncated stdout), and Layer 3 (full suite gated to `L`/`XL` tasks under nominal quota).
- **Standard `npx skills add` Support**: Added direct support and documentation for `npx skills add Thlookingatyou/codex-quota-optimizer --skill codex-quota-optimizer`.
- **Independent Local Telemetry Verification Guide**: Added a 5-second `jq` / `grep` verification one-liner in `README.md` so users and security reviewers can verify `payload.rate_limits` (`primary` 300m and `secondary` 10080m) inside their own `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` logs.

### Changed
- **100% Offline, Zero-Network, Zero-Credential Guarantee**: Completely removed `~/.codex/auth.json` token reading and external `wham/usage` HTTP calls from `check_quota.mjs`. The skill is now strictly offline and read-only, eliminating any credential or network surface area.
- **Repository Attribution**: Replaced all template placeholders with canonical `Thlookingatyou/codex-quota-optimizer` URLs and metadata.

---

## [0.2.0] - 2026-11-04

### Added
- Multi-step task scheduler (`scripts/optimize_work_plan.mjs`) to prioritize `P0` blockers ahead of `P1`/`P2` refactors and prevent mid-task `HTTP 429` lockouts.
- Optional stdio MCP server (`scripts/mcp_server.mjs`) exposing `get_codex_usage_limits` and `optimize_codex_task_plan`.
- Automated `node:test` test suite (`tests/codex_skill.test.ts`) validating `rollout-*.jsonl` parsing and policy transitions.

---

## [0.1.0] - 2026-11-04

### Added
- Initial release of `$codex-quota-optimizer` (`SKILL.md`, `agents/openai.yaml`, `scripts/check_quota.mjs`, and `references/protocol_and_playbooks.md`) reading `primary_window` (5h, 300m) and `secondary_window` (weekly, 10080m) from OpenAI Codex session logs.

## Reliability fixes (unreleased)

- Replace legacy recommendations with current Sol/Luna task routing and separate reasoning settings.
- Preserve missing/stale/expired/partial telemetry as unknown, age reset times, and select events by timestamp.
- Share telemetry loading across CLI and MCP; fix Windows entry points and invalid input failures.
- Check selected rounded task costs against both reserve ceilings; enforce reported limits for all plans.
- Add fixture, missing-telemetry, MCP, mirror parity, and scheduler boundary regressions.
- Add reproducible app dependencies, cross-platform scripts, skill packaging, and explicit publishing.

## Community preparation (unreleased)

- Add a dependency-free, reproducible behavior demo and generated terminal preview with explicit synthetic-input labeling.
- Put installation, real usage, limitations, and testing invitations near the top of the README.
- Add contributor guidance, issue forms, a pull-request template, and a paired benchmark protocol with a blank reporting template.
- Keep real-world quota savings explicitly unmeasured until controlled results are available.
