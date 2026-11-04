#!/usr/bin/env node
/**
 * OpenAI Codex Skill Script: check_quota.mjs
 *
 * Reads both the 5-hour rolling window (`primary_window`, 300 mins) and
 * the 7-day weekly limit (`secondary_window`, 10080 mins) from:
 *   1. ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl (written by codex-core)
 *   2. https://chatgpt.com/backend-api/wham/usage (using ~/.codex/auth.json when --probe-remote is passed)
 *   3. Environment or CLI test overrides (--5h=<pct> --weekly=<pct> --plan=<plus|pro>)
 *
 * Outputs a machine-readable JSON + actionable agent directives for OpenAI Codex.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function parseArgs(argv) {
  const args = {
    format: 'agent', // 'agent' | 'json'
    probeRemote: false,
    codexHome: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    override5h: process.env.CODEX_PRIMARY_USED_PCT ? Number(process.env.CODEX_PRIMARY_USED_PCT) : null,
    overrideWeekly: process.env.CODEX_WEEKLY_USED_PCT ? Number(process.env.CODEX_WEEKLY_USED_PCT) : null,
    override5hResetSec: process.env.CODEX_PRIMARY_RESET_SEC ? Number(process.env.CODEX_PRIMARY_RESET_SEC) : null,
    overrideWeeklyResetSec: process.env.CODEX_WEEKLY_RESET_SEC ? Number(process.env.CODEX_WEEKLY_RESET_SEC) : null,
    overridePlan: process.env.CODEX_PLAN_TYPE || null,
    rolloutFile: null,
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--probe-remote') args.probeRemote = true;
    else if (arg.startsWith('--format=')) args.format = arg.split('=')[1];
    else if (arg.startsWith('--codex-home=')) args.codexHome = arg.split('=')[1];
    else if (arg.startsWith('--rollout-file=')) args.rolloutFile = arg.split('=')[1];
    else if (arg.startsWith('--5h=')) args.override5h = Number(arg.split('=')[1]);
    else if (arg.startsWith('--weekly=')) args.overrideWeekly = Number(arg.split('=')[1]);
    else if (arg.startsWith('--5h-reset-sec=')) args.override5hResetSec = Number(arg.split('=')[1]);
    else if (arg.startsWith('--weekly-reset-sec=')) args.overrideWeeklyResetSec = Number(arg.split('=')[1]);
    else if (arg.startsWith('--plan=')) args.overridePlan = arg.split('=')[1];
  }
  return args;
}

export function formatDuration(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(safe / 86400);
  const h = Math.floor((safe % 86400) / 3600);
  const m = Math.floor((safe % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function parseRolloutJsonlContent(content, sourcePath = 'rollout.jsonl') {
  const lines = content.trim().split('\n').reverse();
  const nowSec = Math.floor(Date.now() / 1000);

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      const rateLimits =
        parsed?.payload?.rate_limits ||
        parsed?.rate_limits ||
        parsed?.msg?.rate_limits;

      const primary = rateLimits?.primary || rateLimits?.primary_window;
      const secondary = rateLimits?.secondary || rateLimits?.secondary_window;

      if (primary && typeof primary.used_percent === 'number') {
        const pResetSec =
          primary.resets_in_seconds ??
          (primary.resets_at ? Math.max(0, primary.resets_at - nowSec) : 10800);
        const sResetSec =
          secondary?.resets_in_seconds ??
          (secondary?.resets_at ? Math.max(0, secondary.resets_at - nowSec) : 432000);

        return {
          plan_type: rateLimits.plan_type || 'plus',
          source: `rollout_jsonl (${path.basename(sourcePath)})`,
          captured_at: parsed.timestamp || new Date().toISOString(),
          primary_window: {
            window_minutes: Number(primary.window_minutes ?? 300),
            used_percent: Number(primary.used_percent),
            resets_in_seconds: Number(pResetSec),
          },
          secondary_window: {
            window_minutes: Number(secondary?.window_minutes ?? 10080),
            used_percent: Number(secondary?.used_percent ?? 0),
            resets_in_seconds: Number(sResetSec),
          },
        };
      }
    } catch {
      // Skip malformed line
    }
  }
  return null;
}

export function findLatestRolloutSnapshot(codexHome, explicitFile = null) {
  if (explicitFile && fs.existsSync(explicitFile)) {
    const content = fs.readFileSync(explicitFile, 'utf8');
    return parseRolloutJsonlContent(content, explicitFile);
  }

  const sessionsDir = path.join(codexHome, 'sessions');
  if (!fs.existsSync(sessionsDir)) return null;

  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
        files.push({ full, mtimeMs: fs.statSync(full).mtimeMs });
      }
    }
  }
  walk(sessionsDir);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const f of files.slice(0, 6)) {
    const snap = parseRolloutJsonlContent(fs.readFileSync(f.full, 'utf8'), f.full);
    if (snap) return snap;
  }
  return null;
}

async function probeWhamUsageApi(codexHome) {
  const authFile = path.join(codexHome, 'auth.json');
  if (!fs.existsSync(authFile)) return null;

  try {
    const auth = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    const token = auth?.tokens?.access_token || auth?.access_token;
    if (!token) return null;

    const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const p = data?.rate_limit?.primary_window;
    const s = data?.rate_limit?.secondary_window;
    if (!p) return null;

    return {
      plan_type: data?.plan_type || 'plus',
      source: 'wham_usage_api',
      captured_at: new Date().toISOString(),
      primary_window: {
        window_minutes: 300,
        used_percent: Number(p.used_percent ?? 0),
        resets_in_seconds: Number(p.reset_after_seconds ?? 10800),
      },
      secondary_window: {
        window_minutes: 10080,
        used_percent: Number(s?.used_percent ?? 0),
        resets_in_seconds: Number(s?.reset_after_seconds ?? 432000),
      },
    };
  } catch {
    return null;
  }
}

export function buildAgentQuotaReport(rawSnapshot, options = {}) {
  const warn5h = Number(options.warn5h ?? process.env.CODEX_QUOTA_FIVE_HOUR_WARN ?? 65);
  const crit5h = Number(options.crit5h ?? process.env.CODEX_QUOTA_FIVE_HOUR_CRIT ?? 85);
  const warnWeekly = Number(options.warnWeekly ?? process.env.CODEX_QUOTA_WEEKLY_WARN ?? 70);
  const critWeekly = Number(options.critWeekly ?? process.env.CODEX_QUOTA_WEEKLY_CRIT ?? 88);
  const reservePct = Number(options.reservePct ?? process.env.CODEX_QUOTA_RESERVE_PCT ?? 5);
  const proExempt5h = (options.proExempt5h ?? process.env.CODEX_PRO_EXEMPT_5H ?? 'true') !== 'false';

  const plan = rawSnapshot.plan_type || 'plus';
  const isProExempt = proExempt5h && (plan === 'pro' || plan === 'enterprise');

  const used5h = Math.max(0, Math.min(100, Number(rawSnapshot.primary_window.used_percent)));
  const usedWeekly = Math.max(0, Math.min(100, Number(rawSnapshot.secondary_window.used_percent)));

  const reset5hSec = Math.max(0, Number(rawSnapshot.primary_window.resets_in_seconds));
  const resetWeeklySec = Math.max(0, Number(rawSnapshot.secondary_window.resets_in_seconds));

  const elapsed5hPct = Math.max(5, ((18000 - Math.min(18000, reset5hSec)) / 18000) * 100);
  const elapsedWeeklyPct = Math.max(2, ((604800 - Math.min(604800, resetWeeklySec)) / 604800) * 100);

  const burnVelocity5h = Number((used5h / elapsed5hPct).toFixed(2));
  const burnVelocityWeekly = Number((usedWeekly / elapsedWeeklyPct).toFixed(2));

  const reserveCeiling = 100 - reservePct;
  const rem5h = isProExempt
    ? Math.max(0, Number((reserveCeiling - used5h).toFixed(1)))
    : Math.max(0, Number((reserveCeiling - used5h).toFixed(1)));
  const remWeekly = Math.max(0, Number((reserveCeiling - usedWeekly).toFixed(1)));

  let mode = 'NOMINAL';
  let governingWindow = 'balanced';
  let maxFileReadLines = 400;
  let allowSubagents = true;
  let recommendedReasoningEffort = 'high';
  let recommendedModel = 'gpt-5-codex';
  let testStrategy = 'full-suite';
  let heartbeatEveryTurns = 5;
  let directives = [];

  if ((!isProExempt && used5h >= reserveCeiling) || usedWeekly >= reserveCeiling) {
    mode = 'RESERVE_STOP';
    governingWindow = usedWeekly >= reserveCeiling ? 'secondary_weekly_10080m' : 'primary_5h_300m';
    maxFileReadLines = 40;
    allowSubagents = false;
    recommendedReasoningEffort = 'minimal';
    recommendedModel = 'codex-mini-latest';
    testStrategy = 'skip-heavy-tests-and-checkpoint';
    heartbeatEveryTurns = 1;
    directives = [
      `STOP BEFORE HTTP 429: Quota reached ${Math.max(used5h, usedWeekly)}% (safety reserve ceiling is ${reserveCeiling}%).`,
      'Ensure all edited files are syntactically complete; do NOT start new multi-file refactors.',
      `Write CODEX_CHECKPOINT.md with remaining tasks and reset countdown (5h resets in ${formatDuration(reset5hSec)}, weekly resets in ${formatDuration(resetWeeklySec)}).`,
    ];
  } else if (usedWeekly >= critWeekly || (!isProExempt && used5h >= crit5h)) {
    mode = 'CRITICAL_SURGICAL';
    governingWindow = usedWeekly >= critWeekly ? 'secondary_weekly_10080m' : 'primary_5h_300m';
    maxFileReadLines = 80;
    allowSubagents = false;
    recommendedReasoningEffort = 'low';
    recommendedModel = 'codex-mini-latest';
    testStrategy = 'typecheck-only';
    heartbeatEveryTurns = 2;
    directives = [
      'CRITICAL QUOTA: Execute P0 blocker requirements only; defer P1/P2 cleanup or secondary refactors.',
      'Use rg -n to locate exact symbols and read <= 80 lines per file via sed -n. Never read whole files.',
      'Do NOT spawn subagents. Combine edits per file into a single patch.',
      'Verify via fast static typecheck (tsc --noEmit) and pipe all command output through | tail -n 20.',
    ];
  } else if (usedWeekly >= warnWeekly || (!isProExempt && used5h >= warn5h)) {
    mode = 'WARNING_CONSERVE';
    governingWindow = usedWeekly >= warnWeekly ? 'secondary_weekly_10080m' : 'primary_5h_300m';
    maxFileReadLines = 150;
    allowSubagents = false;
    recommendedReasoningEffort = 'medium';
    recommendedModel = 'gpt-5-codex-medium';
    testStrategy = 'affected-unit-tests-only';
    heartbeatEveryTurns = 3;
    directives = [
      'WARNING QUOTA: Conserve tokens across both 5h and weekly windows.',
      'Prefer rg -n + targeted line ranges (<= 150 lines) over full-file reads.',
      'Disable parallel subagents; execute sequentially with batched file edits.',
      'Run unit tests only on modified modules and truncate test output (| tail -n 30).',
    ];
  } else {
    mode = 'NOMINAL';
    governingWindow = !isProExempt && used5h > usedWeekly ? 'primary_5h_300m' : 'secondary_weekly_10080m';
    directives = [
      'Both 5-hour and weekly windows have comfortable headroom.',
      'Full agentic exploration, subagent delegation, and complete test suite verification permitted.',
      `Re-check quota via check_quota.mjs after ${heartbeatEveryTurns} tool turns.`,
    ];
  }

  return {
    skill: 'codex-quota-optimizer',
    plan_type: plan,
    pro_exempt_5h: isProExempt,
    source: rawSnapshot.source,
    captured_at: rawSnapshot.captured_at,
    primary_window_5h: {
      window_minutes: 300,
      used_percent: used5h,
      remaining_effective_percent: rem5h,
      resets_in_seconds: reset5hSec,
      resets_in_human: formatDuration(reset5hSec),
      burn_velocity_ratio: burnVelocity5h,
    },
    secondary_window_weekly: {
      window_minutes: 10080,
      used_percent: usedWeekly,
      remaining_effective_percent: remWeekly,
      resets_in_seconds: resetWeeklySec,
      resets_in_human: formatDuration(resetWeeklySec),
      burn_velocity_ratio: burnVelocityWeekly,
    },
    optimization_policy: {
      mode,
      governing_window: governingWindow,
      recommended_model: recommendedModel,
      recommended_reasoning_effort: recommendedReasoningEffort,
      max_file_read_lines: maxFileReadLines,
      allow_subagents: allowSubagents,
      test_strategy: testStrategy,
      heartbeat_every_turns: heartbeatEveryTurns,
      mandatory_directives: directives,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);

  let snapshot = findLatestRolloutSnapshot(args.codexHome, args.rolloutFile);

  if (!snapshot && args.probeRemote) {
    snapshot = await probeWhamUsageApi(args.codexHome);
  }

  if (!snapshot) {
    snapshot = {
      plan_type: args.overridePlan || 'plus',
      source: args.override5h !== null || args.overrideWeekly !== null ? 'cli_or_env_override' : 'default_baseline (no ~/.codex/sessions rollout found)',
      captured_at: new Date().toISOString(),
      primary_window: {
        window_minutes: 300,
        used_percent: args.override5h ?? 32,
        resets_in_seconds: args.override5hResetSec ?? 11400,
      },
      secondary_window: {
        window_minutes: 10080,
        used_percent: args.overrideWeekly ?? 41,
        resets_in_seconds: args.overrideWeeklyResetSec ?? 388800,
      },
    };
  } else {
    if (args.override5h !== null) snapshot.primary_window.used_percent = args.override5h;
    if (args.overrideWeekly !== null) snapshot.secondary_window.used_percent = args.overrideWeekly;
    if (args.override5hResetSec !== null) snapshot.primary_window.resets_in_seconds = args.override5hResetSec;
    if (args.overrideWeeklyResetSec !== null) snapshot.secondary_window.resets_in_seconds = args.overrideWeeklyResetSec;
    if (args.overridePlan !== null) snapshot.plan_type = args.overridePlan;
  }

  const report = buildAgentQuotaReport(snapshot);

  if (args.format === 'json') {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }

  const p = report.primary_window_5h;
  const s = report.secondary_window_weekly;
  const pol = report.optimization_policy;

  const banner = [
    '================================================================================',
    `[CODEX QUOTA OPTIMIZER] MODE: ${pol.mode} | PLAN: ${report.plan_type.toUpperCase()}`,
    `  • 5-Hour Window (300m):    ${p.used_percent}% used (${p.remaining_effective_percent}% usable left) | Resets in ${p.resets_in_human} | Velocity: ${p.burn_velocity_ratio}x`,
    `  • Weekly Limit  (10080m):  ${s.used_percent}% used (${s.remaining_effective_percent}% usable left) | Resets in ${s.resets_in_human} | Velocity: ${s.burn_velocity_ratio}x`,
    `  • Agent Constraints:       max_file_read_lines=${pol.max_file_read_lines} | allow_subagents=${pol.allow_subagents} | test_strategy=${pol.test_strategy}`,
    `  • Recommended Config:      model=${pol.recommended_model} | reasoning_effort=${pol.recommended_reasoning_effort}`,
    '  • Mandatory Directives for Codex:',
    ...pol.mandatory_directives.map((d, i) => `      ${i + 1}. ${d}`),
    '================================================================================',
    JSON.stringify(report, null, 2),
  ].join('\n');

  process.stdout.write(banner + '\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main();
}
