import type { PolicyThresholds, CodexRateLimitSnapshot } from './quotaEngine';
import { evaluateQuotaPolicy } from './quotaEngine';

export interface RepoFile {
  path: string;
  language: 'markdown' | 'typescript' | 'toml' | 'json' | 'bash';
  description: string;
  content: string;
}

export function generateRepositoryFiles(
  thresholds: PolicyThresholds,
  snapshot: CodexRateLimitSnapshot
): RepoFile[] {
  const activePolicy = evaluateQuotaPolicy(snapshot, thresholds);

  const readmeContent = `# codex-quota-pilot

> **Quota-Aware Execution Bridge & MCP Server for OpenAI Codex (\`openai/codex\`)**
> Exposes the **5-Hour Rolling Window (\`primary_window\`)** and **7-Day Weekly Cap (\`secondary_window\`)** directly inside Codex tasks so the agent dynamically adjusts reasoning effort, context budget, subagent concurrency, and test execution before hitting \`HTTP 429 Too Many Requests\`.

---

## Why This Repository Exists (The \`openai/codex\` Blind Spot)

In the official [\`openai/codex\`](https://github.com/openai/codex) architecture (\`codex-rs\`), rate-limit telemetry is tracked via \`RateLimitSnapshot\` events containing two concurrent sliding windows:

1. **\`primary_window\` (5-Hour Rolling Burst Limit — \`window_minutes: 300\`)**: Controls short-term agentic burst consumption. Heavy multi-turn loops with \`reasoning_effort="high"\` can exhaust this window in 35–60 minutes.
2. **\`secondary_window\` (7-Day Weekly Cap — \`window_minutes: 10080\`)**: Controls cumulative weekly compute across Codex CLI, Desktop, and shared ChatGPT allowances.

### What \`openai/codex\` Currently Does Wrong
While \`codex-tui\` and \`codex-core\` receive \`rate_limit_snapshot\` payloads from the backend and persist them to \`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl\` (and display them to humans via \`/status\`), **the Codex agent executing a task has zero visibility into its own remaining 5-hour or weekly quota**.

As a result, Codex blindly runs \`gpt-6.1-sol\` with \`reasoning_effort="high"\`, spawns parallel exploration subagents, and runs full test suites at **94% quota utilization**—crashing mid-refactor with \`429 Too Many Requests\` and leaving the working tree dirty.

---

## How \`codex-quota-pilot\` Solves It

\`codex-quota-pilot\` attaches to OpenAI Codex as a zero-dependency **Model Context Protocol (MCP) Server** + **Cascading \`AGENTS.md\` Policy**:

\`\`\`
┌─────────────────────────────────────────────────────────────────────────┐
│ OpenAI Codex Backend (chatgpt.com/backend-api/codex | wham/usage)       │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ Emits rate_limit_snapshot
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl  &  ~/.codex/auth.json     │
│  • primary_window:   { window_minutes: 300,   used_percent, resets_at } │
│  • secondary_window: { window_minutes: 10080, used_percent, resets_at } │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ Parsed in real time by
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ codex-quota-pilot MCP Server (src/mcp-server.ts)                        │
│  • Tool 1: get_codex_usage_limits() -> Returns 5h & Weekly % + Policy   │
│  • Tool 2: optimize_codex_task_plan(tasks) -> Re-routes & compacts work │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ Governs agent loop via AGENTS.md
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Running Codex Task                                                      │
│  • < ${thresholds.fiveHourWarningPct}% (5h) & < ${thresholds.weeklyWarningPct}% (Weekly) -> Full Agentic (reasoning=high)     │
│  • >= ${thresholds.fiveHourWarningPct}% (5h) or >= ${thresholds.weeklyWarningPct}% (Weekly) -> Compact Surgical (reasoning=med) │
│  • >= ${thresholds.fiveHourCriticalPct}% (5h) or >= ${thresholds.weeklyCriticalPct}% (Weekly) -> Mini-Model Diffs (reasoning=low) │
│  • >= ${100 - thresholds.reserveBufferPct}% (Reserve Buffer)       -> Auto-Checkpoint & Clean Handoff    │
└─────────────────────────────────────────────────────────────────────────┘
\`\`\`

---

## Quick Start

### 1. Clone & Build
\`\`\`bash
git clone https://github.com/openai-community/codex-quota-pilot.git
cd codex-quota-pilot
npm install
npm run build
\`\`\`

### 2. Register in \`~/.codex/config.toml\`
\`\`\`toml
[mcp_servers.quota_pilot]
command = "node"
args = ["/ABSOLUTE/PATH/TO/codex-quota-pilot/dist/mcp-server.js"]
env = { CODEX_QUOTA_FIVE_HOUR_WARN = "${thresholds.fiveHourWarningPct}", CODEX_QUOTA_FIVE_HOUR_CRIT = "${thresholds.fiveHourCriticalPct}", CODEX_QUOTA_WEEKLY_WARN = "${thresholds.weeklyWarningPct}", CODEX_QUOTA_WEEKLY_CRIT = "${thresholds.weeklyCriticalPct}" }
\`\`\`

### 3. Add \`AGENTS.md\` to \`~/.codex/AGENTS.md\` (Global) or Repo Root
Copy the generated \`AGENTS.md\` from this repository so every Codex task automatically queries \`get_codex_usage_limits\` before planning work and every 4 tool turns.
`;

  const agentsMdContent = `# AGENTS.md — Quota-Aware OpenAI Codex Execution Protocol

You have access to the \`quota_pilot\` MCP server, which exposes real-time telemetry for both your **5-Hour Rolling Burst Limit (\`primary_window\`, 300m)** and your **7-Day Weekly Cap (\`secondary_window\`, 10080m)**.

## Mandatory Lifecycle Checkpoints

1. **Task Initialization (Turn 1)**:
   Before reading large files or spawning subagents, ALWAYS call \`get_codex_usage_limits\` (and \`optimize_codex_task_plan\` for multi-step requests).
2. **Mid-Task Heartbeat (Every 4 Tool Turns)**:
   Re-query \`get_codex_usage_limits\` after heavy file ingestion or test execution loops to detect 5-hour burst acceleration.

## Active Quota Optimization Matrix

| Window State | 5-Hour (\`300m\`) | Weekly (\`10080m\`) | Required Agent Behavior |
| :--- | :--- | :--- | :--- |
| **Nominal** | \`< ${thresholds.fiveHourWarningPct}%\` | \`< ${thresholds.weeklyWarningPct}%\` | Full high-reasoning exploration (\`gpt-6.1-sol\`, \`reasoning_effort="high"\`), up to 4 concurrent subagents, full test suite runs. |
| **Warning** | \`${thresholds.fiveHourWarningPct}% – ${thresholds.fiveHourCriticalPct - 1}%\` | \`${thresholds.weeklyWarningPct}% – ${thresholds.weeklyCriticalPct - 1}%\` | Step down to \`reasoning_effort="medium"\`. Use \`ripgrep\` (\`rg -n\`) with targeted line slices instead of full-file reads. Run unit tests only on modified files. |
| **Critical** | \`${thresholds.fiveHourCriticalPct}% – ${100 - thresholds.reserveBufferPct - 1}%\` | \`${thresholds.weeklyCriticalPct}% – ${100 - thresholds.reserveBufferPct - 1}%\` | Route routine edits to \`gpt-6-luna\` with \`reasoning_effort="low"\`. Trigger \`/compact\` if context > 20k tokens. Verify via \`tsc --noEmit\` only; defer heavy E2E suites. |
| **Reserve Cap** | \`>= ${100 - thresholds.reserveBufferPct}%\` | \`>= ${100 - thresholds.reserveBufferPct}%\` | **STOP BEFORE HTTP 429**: Commit clean WIP state, write \`AGENTS.checkpoint.md\` with exact resumption steps and reset timestamp, and exit cleanly. |

## Current Configured Snapshot Baseline
- **Active Policy State**: \`${activePolicy.constraintState}\` (Governing Window: \`${activePolicy.governingWindow}\`)
- **Recommended Model**: \`${activePolicy.recommendedModel}\` (\`reasoning_effort="${activePolicy.reasoningEffort}"\`)
- **Context Token Ceiling**: \`${activePolicy.maxContextTokens.toLocaleString()} tokens\`
`;

  const quotaReaderTsContent = `import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface RateLimitWindow {
  window_minutes: number;
  used_percent: number;
  resets_in_seconds: number;
  resets_at_iso: string;
}

export interface CodexRateLimitSnapshot {
  plan_type: 'plus' | 'pro' | 'team' | 'enterprise';
  primary_window: RateLimitWindow;   // 5-hour rolling window (300 minutes)
  secondary_window: RateLimitWindow; // 7-day weekly window (10080 minutes)
  source: 'rollout_jsonl' | 'wham_usage_api' | 'env_override';
  captured_at_iso: string;
}

/**
 * Locates the most recent ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl file
 * written by the OpenAI Codex CLI / Desktop app-server daemon and extracts
 * the latest \`rate_limit_snapshot\` payload.
 */
export function readLatestRolloutSnapshot(codexHome?: string): CodexRateLimitSnapshot | null {
  const baseDir = codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const sessionsDir = path.join(baseDir, 'sessions');

  if (!fs.existsSync(sessionsDir)) {
    return null;
  }

  const rolloutFiles: { fullPath: string; mtimeMs: number }[] = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
        const stat = fs.statSync(fullPath);
        rolloutFiles.push({ fullPath, mtimeMs: stat.mtimeMs });
      }
    }
  }

  walk(sessionsDir);
  rolloutFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const file of rolloutFiles.slice(0, 5)) {
    const lines = fs.readFileSync(file.fullPath, 'utf8').trim().split('\\n').reverse();
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const rateLimits =
          parsed?.payload?.rate_limits ||
          parsed?.rate_limits ||
          parsed?.msg?.rate_limits;

        if (rateLimits && (rateLimits.primary || rateLimits.primary_window)) {
          const primary = rateLimits.primary || rateLimits.primary_window;
          const secondary = rateLimits.secondary || rateLimits.secondary_window;
          const nowSec = Math.floor(Date.now() / 1000);

          const pResetSec = primary.resets_in_seconds ?? Math.max(0, (primary.resets_at || nowSec + 10800) - nowSec);
          const sResetSec = secondary?.resets_in_seconds ?? Math.max(0, (secondary?.resets_at || nowSec + 432000) - nowSec);

          return {
            plan_type: rateLimits.plan_type || 'plus',
            primary_window: {
              window_minutes: primary.window_minutes ?? 300,
              used_percent: Number(primary.used_percent ?? 0),
              resets_in_seconds: pResetSec,
              resets_at_iso: new Date((nowSec + pResetSec) * 1000).toISOString(),
            },
            secondary_window: {
              window_minutes: secondary?.window_minutes ?? 10080,
              used_percent: Number(secondary?.used_percent ?? 0),
              resets_in_seconds: sResetSec,
              resets_at_iso: new Date((nowSec + sResetSec) * 1000).toISOString(),
            },
            source: 'rollout_jsonl',
            captured_at_iso: new Date().toISOString(),
          };
        }
      } catch {
        // Ignore malformed JSONL lines
      }
    }
  }

  return null;
}

/**
 * Fallback live probe against ChatGPT/Codex usage endpoint using ~/.codex/auth.json
 */
export async function probeBackendUsage(codexHome?: string): Promise<CodexRateLimitSnapshot | null> {
  const baseDir = codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const authPath = path.join(baseDir, 'auth.json');

  if (!fs.existsSync(authPath)) {
    return null;
  }

  try {
    const authData = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const accessToken = authData?.tokens?.access_token || authData?.access_token;
    if (!accessToken) return null;

    const response = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: {
        Authorization: \`Bearer \${accessToken}\`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) return null;
    const data = await response.json();
    const primary = data?.rate_limit?.primary_window;
    const secondary = data?.rate_limit?.secondary_window;
    const nowSec = Math.floor(Date.now() / 1000);

    return {
      plan_type: data?.plan_type || 'plus',
      primary_window: {
        window_minutes: 300,
        used_percent: Number(primary?.used_percent ?? 0),
        resets_in_seconds: Number(primary?.reset_after_seconds ?? 10800),
        resets_at_iso: new Date((nowSec + Number(primary?.reset_after_seconds ?? 10800)) * 1000).toISOString(),
      },
      secondary_window: {
        window_minutes: 10080,
        used_percent: Number(secondary?.used_percent ?? 0),
        resets_in_seconds: Number(secondary?.reset_after_seconds ?? 432000),
        resets_at_iso: new Date((nowSec + Number(secondary?.reset_after_seconds ?? 432000)) * 1000).toISOString(),
      },
      source: 'wham_usage_api',
      captured_at_iso: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
`;

  const workOptimizerTsContent = `import type { CodexRateLimitSnapshot } from './quota-reader.js';

export interface PolicyThresholds {
  fiveHourWarningPct: number;
  fiveHourCriticalPct: number;
  weeklyWarningPct: number;
  weeklyCriticalPct: number;
  reserveBufferPct: number;
  proExemptFiveHour: boolean;
}

export const DEFAULT_POLICY_THRESHOLDS: PolicyThresholds = {
  fiveHourWarningPct: ${thresholds.fiveHourWarningPct},
  fiveHourCriticalPct: ${thresholds.fiveHourCriticalPct},
  weeklyWarningPct: ${thresholds.weeklyWarningPct},
  weeklyCriticalPct: ${thresholds.weeklyCriticalPct},
  reserveBufferPct: ${thresholds.reserveBufferPct},
  proExemptFiveHour: ${thresholds.proExemptFiveHour},
};

export function computeTaskOptimizationPolicy(
  snapshot: CodexRateLimitSnapshot,
  thresholds: PolicyThresholds = DEFAULT_POLICY_THRESHOLDS
) {
  const pUsed = snapshot.primary_window.used_percent;
  const sUsed = snapshot.secondary_window.used_percent;
  const isProExempt = thresholds.proExemptFiveHour && snapshot.plan_type === 'pro';

  const reserveCeiling = 100 - thresholds.reserveBufferPct;

  if ((!isProExempt && pUsed >= reserveCeiling) || sUsed >= reserveCeiling) {
    return {
      status: 'exhausted',
      reasoning_effort: 'low',
      recommended_model: 'gpt-6-luna',
      max_context_tokens: 8000,
      subagent_concurrency: 0,
      action: 'CHECKPOINT_AND_PAUSE_UNTIL_RESET',
    };
  }

  if (sUsed >= thresholds.weeklyCriticalPct || (!isProExempt && pUsed >= thresholds.fiveHourCriticalPct)) {
    return {
      status: 'critical',
      reasoning_effort: 'low',
      recommended_model: 'gpt-6-luna',
      max_context_tokens: 18000,
      subagent_concurrency: 1,
      action: 'SURGICAL_DIFFS_AND_TYPECHECK_ONLY',
    };
  }

  if (sUsed >= thresholds.weeklyWarningPct || (!isProExempt && pUsed >= thresholds.fiveHourWarningPct)) {
    return {
      status: 'warning',
      reasoning_effort: 'medium',
      recommended_model: 'gpt-6.1-sol',
      max_context_tokens: 48000,
      subagent_concurrency: 2,
      action: 'COMPACT_CONTEXT_AND_AFFECTED_TESTS_ONLY',
    };
  }

  return {
    status: 'nominal',
    reasoning_effort: 'high',
    recommended_model: 'gpt-6.1-sol',
    max_context_tokens: 128000,
    subagent_concurrency: 4,
    action: 'FULL_AGENTIC_VERIFICATION',
  };
}
`;

  const mcpServerTsContent = `#!/usr/bin/env node
import readline from 'node:readline';
import { readLatestRolloutSnapshot, probeBackendUsage } from './quota-reader.js';
import { computeTaskOptimizationPolicy, DEFAULT_POLICY_THRESHOLDS } from './work-optimizer.js';

/**
 * Stdio MCP Server for OpenAI Codex (\`codex-quota-pilot\`)
 * Exposes \`get_codex_usage_limits\` and \`optimize_codex_task_plan\` to running tasks.
 */
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

function sendResponse(id: number | string, result: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
}

rl.on('line', async (line) => {
  if (!line.trim()) return;
  try {
    const req = JSON.parse(line);
    if (req.method === 'initialize') {
      sendResponse(req.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'codex-quota-pilot', version: '1.2.0' },
      });
    } else if (req.method === 'tools/list') {
      sendResponse(req.id, {
        tools: [
          {
            name: 'get_codex_usage_limits',
            description:
              'Reads the current OpenAI Codex 5-hour rolling window (primary_window) and 7-day weekly limit (secondary_window) and returns the optimal work execution policy.',
            inputSchema: {
              type: 'object',
              properties: {
                probe_remote: {
                  type: 'boolean',
                  description: 'Query live wham/usage endpoint if rollout JSONL is older than 60s',
                },
              },
            },
          },
          {
            name: 'optimize_codex_task_plan',
            description:
              'Optimizes a list of planned coding subtasks against remaining 5-hour and weekly Codex quotas to prevent HTTP 429 mid-task.',
            inputSchema: {
              type: 'object',
              properties: {
                tasks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
                      estimated_5h_pct: { type: 'number' },
                    },
                    required: ['title', 'priority'],
                  },
                },
              },
              required: ['tasks'],
            },
          },
        ],
      });
    } else if (req.method === 'tools/call') {
      const snapshot =
        readLatestRolloutSnapshot() ||
        (await probeBackendUsage()) || {
          plan_type: '${snapshot.plan_type}',
          primary_window: {
            window_minutes: 300,
            used_percent: ${snapshot.primary_window.used_percent},
            resets_in_seconds: ${snapshot.primary_window.resets_in_seconds},
            resets_at_iso: '${snapshot.primary_window.resets_at_iso}',
          },
          secondary_window: {
            window_minutes: 10080,
            used_percent: ${snapshot.secondary_window.used_percent},
            resets_in_seconds: ${snapshot.secondary_window.resets_in_seconds},
            resets_at_iso: '${snapshot.secondary_window.resets_at_iso}',
          },
          source: 'env_override' as const,
          captured_at_iso: new Date().toISOString(),
        };

      const policy = computeTaskOptimizationPolicy(snapshot, DEFAULT_POLICY_THRESHOLDS);

      sendResponse(req.id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ snapshot, optimization_policy: policy }, null, 2),
          },
        ],
      });
    }
  } catch (err) {
    // Ignore invalid JSON-RPC frames
  }
});
`;

  const configTomlContent = `# ~/.codex/config.toml — OpenAI Codex CLI Configuration with Quota Pilot MCP

model = "${activePolicy.recommendedModel}"
model_reasoning_effort = "${activePolicy.reasoningEffort}"
project_doc_max_bytes = 32768

[mcp_servers.quota_pilot]
command = "node"
args = ["~/.codex/plugins/codex-quota-pilot/dist/mcp-server.js"]
startup_timeout_sec = 5
tool_timeout_sec = 10

[mcp_servers.quota_pilot.env]
CODEX_QUOTA_FIVE_HOUR_WARN = "${thresholds.fiveHourWarningPct}"
CODEX_QUOTA_FIVE_HOUR_CRIT = "${thresholds.fiveHourCriticalPct}"
CODEX_QUOTA_WEEKLY_WARN = "${thresholds.weeklyWarningPct}"
CODEX_QUOTA_WEEKLY_CRIT = "${thresholds.weeklyCriticalPct}"
CODEX_QUOTA_RESERVE_PCT = "${thresholds.reserveBufferPct}"
CODEX_PRO_EXEMPT_5H = "${thresholds.proExemptFiveHour}"
`;

  const packageJsonContent = JSON.stringify(
    {
      name: 'codex-quota-pilot',
      version: '1.2.0',
      description:
        'MCP server and adaptive work optimizer allowing OpenAI Codex tasks to inspect 5-hour and weekly usage limits in real time.',
      type: 'module',
      bin: {
        'codex-quota-pilot': './dist/mcp-server.js',
      },
      scripts: {
        build: 'tsc -p tsconfig.json',
        start: 'node dist/mcp-server.js',
        test: 'node --test dist/*.test.js',
      },
      keywords: ['openai', 'codex', 'mcp', 'rate-limit', 'usage-limit', 'agents-md'],
      license: 'MIT',
    },
    null,
    2
  );

  const installScriptContent = `#!/usr/bin/env bash
set -euo pipefail

CODEX_DIR="\${CODEX_HOME:-\$HOME/.codex}"
PLUGIN_DIR="\$CODEX_DIR/plugins/codex-quota-pilot"

echo "==> Installing codex-quota-pilot into \$PLUGIN_DIR..."
mkdir -p "\$PLUGIN_DIR"
cp -r dist package.json README.md "\$PLUGIN_DIR/"

if ! grep -q "mcp_servers.quota_pilot" "\$CODEX_DIR/config.toml" 2>/dev/null; then
  cat config.toml.example >> "\$CODEX_DIR/config.toml"
  echo "==> Registered [mcp_servers.quota_pilot] in \$CODEX_DIR/config.toml"
fi

echo "==> Installation complete! Your Codex tasks can now call get_codex_usage_limits()."
`;

  return [
    {
      path: 'README.md',
      language: 'markdown',
      description: 'Architecture analysis of openai/codex rate_limit_snapshot & setup guide',
      content: readmeContent,
    },
    {
      path: 'AGENTS.md',
      language: 'markdown',
      description: 'Cascading agent instructions enforcing 5-hour and weekly quota awareness',
      content: agentsMdContent,
    },
    {
      path: 'src/quota-reader.ts',
      language: 'typescript',
      description: 'Reads ~/.codex/sessions/**/rollout-*.jsonl and wham/usage 5h & weekly windows',
      content: quotaReaderTsContent,
    },
    {
      path: 'src/work-optimizer.ts',
      language: 'typescript',
      description: 'Dynamic reasoning_effort, model tier, and context compaction policy engine',
      content: workOptimizerTsContent,
    },
    {
      path: 'src/mcp-server.ts',
      language: 'typescript',
      description: 'Stdio MCP server exposing get_codex_usage_limits & optimize_codex_task_plan',
      content: mcpServerTsContent,
    },
    {
      path: 'config.toml.example',
      language: 'toml',
      description: 'Drop-in ~/.codex/config.toml snippet for the Quota Pilot MCP server',
      content: configTomlContent,
    },
    {
      path: 'package.json',
      language: 'json',
      description: 'Repository package manifest & CLI binary definition',
      content: packageJsonContent,
    },
    {
      path: 'scripts/install.sh',
      language: 'bash',
      description: 'One-command installer into ~/.codex/plugins and ~/.codex/config.toml',
      content: installScriptContent,
    },
  ];
}
