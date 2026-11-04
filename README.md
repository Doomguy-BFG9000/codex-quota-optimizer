# codex-quota-optimizer (OpenAI Codex Skill Repository)

An official-format **OpenAI Codex Skill (`$codex-quota-optimizer`)**, CLI script suite, and optional MCP server that allows OpenAI Codex tasks to read both their **5-hour rolling usage limit (`primary_window`, 300 minutes)** and **7-day weekly limit (`secondary_window`, 10080 minutes)** and automatically optimize work execution before hitting `HTTP 429 Too Many Requests`.

---

## Repository Structure (Standard OpenAI Codex Skill Layout)

```text
.
├── AGENTS.md                                              # Global/Repo instructions binding Codex to $codex-quota-optimizer
├── install.sh                                             # Installs skill into ~/.codex/skills/ and ~/.codex/AGENTS.md
├── skills/
│   └── codex-quota-optimizer/                             # OpenAI Codex Skill Directory
│       ├── SKILL.md                                       # Agent instructions & YAML frontmatter read by Codex
│       ├── agents/
│       │   └── openai.yaml                                # OpenAI Codex harness metadata & implicit invocation policy
│       ├── scripts/
│       │   ├── check_quota.mjs                            # Reads 5h & weekly limits from rollout-*.jsonl or wham/usage API
│       │   ├── optimize_work_plan.mjs                     # Schedules & throttles subtasks against remaining 5h & weekly quota
│       │   └── mcp_server.mjs                             # Optional stdio MCP server for ~/.codex/config.toml
│       └── references/
│           └── protocol_and_playbooks.md                  # Low-token shell playbooks & RateLimitSnapshot documentation
└── tests/
    └── codex_skill.test.ts                                # Automated node:test suite for the skill scripts
```

---

## How OpenAI Codex Uses This Skill

In the `openai/codex` Rust framework (`codex-rs`), the backend returns a `RateLimitSnapshot` on every turn inside `EventMsg::TokenCount` (`primary` = 300m 5-hour window, `secondary` = 10080m weekly window) and logs it to `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. However, `codex-core` only exposes this to the human TUI (`/status`) and strips it from the agent's context.

When you install this skill into `~/.codex/skills/codex-quota-optimizer` (or `.agents/skills/codex-quota-optimizer`), Codex reads [`skills/codex-quota-optimizer/SKILL.md`](skills/codex-quota-optimizer/SKILL.md) and executes:

```bash
# 1. Inspect 5-hour & weekly usage limits and receive mandatory execution directives:
node ~/.codex/skills/codex-quota-optimizer/scripts/check_quota.mjs --format=agent

# 2. Optimize a multi-step coding plan to fit within the remaining 5-hour & weekly windows:
node ~/.codex/skills/codex-quota-optimizer/scripts/optimize_work_plan.mjs \
  --tasks='[{"id":"1","title":"Fix token refresh bug","priority":"P0","est_5h_pct":8}]'
```

---

## Installation for OpenAI Codex

### Option 1: Install via OpenAI Codex `$skill-installer`
Inside an OpenAI Codex session, run:
```text
$skill-installer install https://github.com/<your-username>/codex-quota-optimizer/tree/main/skills/codex-quota-optimizer
```

### Option 2: One-Command Local Install (`./install.sh`)
```bash
git clone https://github.com/<your-username>/codex-quota-optimizer.git
cd codex-quota-optimizer
chmod +x install.sh
./install.sh
```
This copies `skills/codex-quota-optimizer` into `~/.codex/skills/codex-quota-optimizer`, appends the quota-check rule to `~/.codex/AGENTS.md`, and optionally registers the stdio MCP server in `~/.codex/config.toml`.
