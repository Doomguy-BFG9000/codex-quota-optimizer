# codex-quota-optimizer (`v0.3.0`)

[![Version](https://img.shields.io/badge/version-0.3.0-blue.svg)](./CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Security: 100% Offline](https://img.shields.io/badge/Security-Zero_Network_%7C_Zero_Credentials-emerald.svg)](#security--zero-friction-guarantees)

A **zero-friction, 100% offline OpenAI Codex Skill (`$codex-quota-optimizer`)** that combines **XS–XL task complexity classification** and **3-stage layered verification** with real-time local reading of OpenAI Codex's **5-hour rolling window (`primary_window`, 300m)** and **7-day weekly limit (`secondary_window`, 10080m)** from `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.

- **Repository**: [`https://github.com/Thlookingatyou/codex-quota-optimizer`](https://github.com/Thlookingatyou/codex-quota-optimizer)
- **Author**: [`@Thlookingatyou`](https://github.com/Thlookingatyou)
- **Latest Release**: `v0.3.0` (See [`CHANGELOG.md`](./CHANGELOG.md))

---

## Installation

### Method 1: Standard `npx skills` CLI (Recommended)
```bash
npx skills add Thlookingatyou/codex-quota-optimizer --skill codex-quota-optimizer
```

### Method 2: Inside an OpenAI Codex Session (`$skill-installer`)
```text
$skill-installer install https://github.com/Thlookingatyou/codex-quota-optimizer/tree/main/skills/codex-quota-optimizer
```

### Method 3: Local Clone & `./install.sh`
```bash
git clone https://github.com/Thlookingatyou/codex-quota-optimizer.git
cd codex-quota-optimizer
chmod +x install.sh
./install.sh
```

---

## Why This Project Exists & How It Compares

Most quota savers for OpenAI Codex only provide **static prompt advice** (e.g., "use a smaller model for XS tasks"), without knowing whether your 5-hour or weekly quota is currently at **15%** or **92%**. Conversely, checking `/status` manually requires human intervention before every prompt.

`Thlookingatyou/codex-quota-optimizer` (`v0.3.0`) bridges both worlds—combining **zero-friction XS–XL task complexity sizing** with **verifiable, offline local telemetry from `codex-rs` rollout logs**:

| Capability | Manual `/status` | Static Heuristics (`ctdaniel/codex-quota-optimizer`) | `Thlookingatyou/codex-quota-optimizer` (`v0.3.0`) |
| :--- | :--- | :--- | :--- |
| **Zero Extra LLM Calls** | Yes | Yes | **Yes** (Deterministic local script) |
| **Zero Network / Zero Auth Token Access** | Yes | Yes | **Yes** (100% offline read-only; never touches `auth.json`) |
| **XS–XL Task Complexity Sizing** | No | Yes (`XS`–`XL`) | **Yes** (`--task-size=XS\|S\|M\|L\|XL`) |
| **3-Stage Layered Verification** | No | Yes | **Yes** (Static -> Targeted Unit Test -> Gated Full Suite) |
| **Reads Real 5-Hour (`300m`) & Weekly (`10080m`) Limits** | Manual TUI only | No (Blind to actual remaining %) | **Yes** (Reads local `~/.codex/sessions/**/rollout-*.jsonl`) |
| **Multi-Step Queue Scheduler & Pre-429 Checkpoint** | No | No | **Yes** (`optimize_work_plan.mjs` + 95% reserve handoff) |

---

## How Local 5h & Weekly Telemetry Works (Verify It Yourself in 5 Seconds)

Does OpenAI Codex actually store 5-hour and weekly usage percentages locally on disk? **Yes.**

In the official [`openai/codex`](https://github.com/openai/codex) Rust repository (`codex-rs/protocol/src/protocol.rs`), `codex-core` records a `RateLimitSnapshot` inside `EventMsg::TokenCount` on every turn and appends it to `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`:

```rust
// From openai/codex: codex-rs/protocol/src/protocol.rs
pub struct RateLimitSnapshot {
    pub primary: Option<RateLimitWindow>,   // window_minutes: 300 (5-hour rolling limit)
    pub secondary: Option<RateLimitWindow>, // window_minutes: 10080 (7-day weekly limit)
}
pub struct RateLimitWindow {
    pub used_percent: f64,
    pub window_minutes: Option<u64>,
    pub resets_in_seconds: Option<u64>,
}
```

You can verify this on your own machine right now without installing anything:

```bash
# Inspect the latest rate_limits event written by OpenAI Codex on your machine:
grep -h '"rate_limits"' ~/.codex/sessions/*/*/*/rollout-*.jsonl | tail -n 1
```

`scripts/check_quota.mjs` simply reads the last matching line from `~/.codex/sessions/**/rollout-*.jsonl` (falling back gracefully to pure `XS`–`XL` task sizing if no rollout logs exist yet).

---

## Security & Zero-Friction Guarantees

1. **No Credential Access**: `check_quota.mjs` **never** reads `~/.codex/auth.json`, environment API keys, or git credentials.
2. **No Outbound Network Calls**: There are zero `fetch()`, `http`, or socket calls in the skill scripts.
3. **Zero Dependencies**: Written in pure Node.js ESM (`node:fs`, `node:path`, `node:os`) with an automated test suite (`npm test` / `npx tsx --test tests/codex_skill.test.ts`).

---

## XS–XL Task Complexity × Quota Matrix

When Codex runs `node skills/codex-quota-optimizer/scripts/check_quota.mjs --task-size=<XS|S|M|L|XL>`, it receives a unified routing and verification directive:

1. **`XS` (1 file, <25 lines — typos, config, docs)**:
   - Model: `codex-mini-latest` (`reasoning_effort="low"` or `"minimal"`).
   - Verification: **Layer 1 only** (`git diff` / syntax check).
2. **`S` (1–2 files, <80 lines — isolated bugfix, helper)**:
   - Model: `gpt-5-codex` (`reasoning_effort="low"`), stepping down to `codex-mini-latest` when `5h >= 65%` or `weekly >= 70%`.
   - Verification: **Layer 1 + Layer 2** (run only the single corresponding unit test file, truncated via `| tail -n 25`).
3. **`M` (2–4 files, 80–250 lines — standard feature or refactor)**:
   - Model: `gpt-5-codex` (`reasoning_effort="medium"`), stepping down to `"low"` when quota enters `WARNING_CONSERVE` (`>= 65%`).
   - Verification: **Layer 1 + Layer 2** (affected module tests only).
4. **`L` / `XL` (5+ files — cross-module feature, architecture, deep debugging)**:
   - Model: `gpt-5-codex` (`reasoning_effort="high"` when nominal; `"medium"` in warning; decomposed into checkpointed phases in critical).
   - Verification: **Layers 1–2** after each milestone; **Layer 3** (full test suite) only at the final gate if quota is `NOMINAL`.

---

## Repository Structure

```text
.
├── AGENTS.md                                              # Global/Repo instructions for OpenAI Codex
├── CHANGELOG.md                                           # Release history (v0.1.0 -> v0.3.0)
├── LICENSE                                                # MIT License
├── README.md                                              # Documentation & verification guide
├── install.sh                                             # Local installer for ~/.codex/skills/
├── .agents/skills/codex-quota-optimizer/                  # Auto-discovered repo-scoped skill mirror
├── skills/
│   └── codex-quota-optimizer/                             # Official OpenAI Codex Skill package
│       ├── SKILL.md                                       # Skill manifest & XS-XL / 5h-weekly rules
│       ├── agents/
│       │   └── openai.yaml                                # Codex UI & implicit invocation config
│       ├── scripts/
│       │   ├── check_quota.mjs                            # Offline 5h & weekly rollout parser + XS-XL router
│       │   ├── optimize_work_plan.mjs                     # Multi-step P0-P2 task queue scheduler
│       │   └── mcp_server.mjs                             # Optional local stdio MCP wrapper
│       └── references/
│           └── protocol_and_playbooks.md                  # Low-token shell playbooks (rg + sed slices)
└── tests/
    └── codex_skill.test.ts                                # Automated node:test verification suite
```
