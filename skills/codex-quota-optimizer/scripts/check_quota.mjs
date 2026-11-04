#!/usr/bin/env node
/**
 * OpenAI Codex Skill Script: check_quota.mjs (v0.3.0)
 * Repository: https://github.com/Thlookingatyou/codex-quota-optimizer
 *
 * SECURITY & ZERO-FRICTION GUARANTEES:
 *   - 100% Offline & Read-Only: NEVER makes network requests and NEVER reads ~/.codex/auth.json.
 *   - Zero Extra Model Calls: Pure deterministic calculation combining XS–XL task complexity
 *     with local `RateLimitSnapshot` telemetry from ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
 *   - Graceful Fallback: Works even when no rollout logs exist yet by falling back to XS–XL task sizing.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const SKILL_VERSION = '0.3.0';

const TASK_SIZE_PROFILES = {
  XS: {
    label: 'Extra Small (1 file, <25 lines, typo/config/doc)',
    nominalModel: 'codex-mini-latest',
    nominalEffort: 'low',
    conserveModel: 'codex-mini-latest',
    conserveEffort: 'minimal',
    criticalModel: 'codex-mini-latest',
    criticalEffort: 'minimal',
    baseMaxLines: 80,
    verificationLayer: 'Layer 1 only (syntax/diff check)',
  },
  S: {
    label: 'Small (1-2 files, <80 lines, isolated bugfix/helper)',
    nominalModel: 'gpt-5-codex',
    nominalEffort: 'low',
    conserveModel: 'codex-mini-latest',
    conserveEffort: 'low',
    criticalModel: 'codex-mini-latest',
    criticalEffort: 'low',
    baseMaxLines: 160,
    verificationLayer: 'Layer 1 + Layer 2 (single unit test file)',
  },
  M: {
    label: 'Medium (2-4 files, 80-250 lines, standard feature/refactor)',
    nominalModel: 'gpt-5-codex',
    nominalEffort: 'medium',
    conserveModel: 'gpt-5-codex-medium',
    conserveEffort: 'low',
    criticalModel: 'codex-mini-latest',
    criticalEffort: 'low',
    baseMaxLines: 300,
    verificationLayer: 'Layer 1 + Layer 2 (affected module unit tests)',
  },
  L: {
    label: 'Large (5-8 files, cross-module feature/migration)',
    nominalModel: 'gpt-5-codex',
    nominalEffort: 'high',
    conserveModel: 'gpt-5-codex-medium',
    conserveEffort: 'medium',
    criticalModel: 'codex-mini-latest',
    criticalEffort: 'low',
    baseMaxLines: 400,
    verificationLayer: 'Layer 1 + Layer 2 (defer Layer 3 full suite unless NOMINAL)',
  },
  XL: {
    label: 'Extra Large (8+ files, architecture redesign / deep root-cause debug)',
    nominalModel: 'gpt-5-codex',
    nominalEffort: 'high',
    conserveModel: 'gpt-5-codex-medium',
    conserveEffort: 'medium',
    criticalModel: 'codex-mini-latest',
    criticalEffort: 'low',
    baseMaxLines: 400,
    verificationLayer: 'Phased Layer 1-2 per milestone; Layer 3 full suite only when NOMINAL',
  },
};

function parseArgs(argv) {
  const args = {
    format: 'agent', // 'agent' | 'json'
    taskSize: (process.env.CODEX_TASK_SIZE || 'M').toUpperCase(),
    codexHome: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    override5h: process.env.CODEX_PRIMARY_USED_PCT ? Number(process.env.CODEX_PRIMARY_USED_PCT) : null,
    overrideWeekly: process.env.CODEX_WEEKLY_USED_PCT ? Number(process.env.CODEX_WEEKLY_USED_PCT) : null,
    override5hResetSec: process.env.CODEX_PRIMARY_RESET_SEC ? Number(process.env.CODEX_PRIMARY_RESET_SEC) : null,
    overrideWeeklyResetSec: process.env.CODEX_WEEKLY_RESET_SEC ? Number(process.env.CODEX_WEEKLY_RESET_SEC) : null,
    overridePlan: process.env.CODEX_PLAN_TYPE || null,
    rolloutFile: null,
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--format=')) args.format = arg.split('=')[1];
    else if (arg.startsWith('--task-size=')) args.taskSize = arg.split('=')[1].toUpperCase();
    else if (arg.startsWith('--codex-home=')) args.codexHome = arg.split('=')[1];
    else if (arg.startsWith('--rollout-file=')) args.rolloutFile = arg.split('=')[1];
    else if (arg.startsWith('--5h=')) args.override5h = Number(arg.split('=')[1]);
    else if (arg.startsWith('--weekly=')) args.overrideWeekly = Number(arg.split('=')[1]);
    else if (arg.startsWith('--5h-reset-sec=')) args.override5hResetSec = Number(arg.split('=')[1]);
    else if (arg.startsWith('--weekly-reset-sec=')) args.overrideWeeklyResetSec = Number(arg.split('=')[1]);
    else if (arg.startsWith('--plan=')) args.overridePlan = arg.split('=')[1];
  }

  if (!TASK_SIZE_PROFILES[args.taskSize]) {
    args.taskSize = 'M';
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

/**
 * Parses a local ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl file for the latest
 * `EventMsg::TokenCount` containing `rate_limits.primary` (300m) and `rate_limits.secondary` (10080m).
 * Strictly offline and read-only.
 */
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
          telemetry_status: 'live_local_rollout_jsonl',
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
      // Ignore malformed JSONL lines
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

export function buildAgentQuotaReport(rawSnapshot, options = {}) {
  const warn5h = Number(options.warn5h ?? process.env.CODEX_QUOTA_FIVE_HOUR_WARN ?? 65);
  const crit5h = Number(options.crit5h ?? process.env.CODEX_QUOTA_FIVE_HOUR_CRIT ?? 85);
  const warnWeekly = Number(options.warnWeekly ?? process.env.CODEX_QUOTA_WEEKLY_WARN ?? 70);
  const critWeekly = Number(options.critWeekly ?? process.env.CODEX_QUOTA_WEEKLY_CRIT ?? 88);
  const reservePct = Number(options.reservePct ?? process.env.CODEX_QUOTA_RESERVE_PCT ?? 5);
  const proExempt5h = (options.proExempt5h ?? process.env.CODEX_PRO_EXEMPT_5H ?? 'true') !== 'false';

  const taskSizeKey = TASK_SIZE_PROFILES[options.taskSize] ? options.taskSize : 'M';
  const sizeProfile = TASK_SIZE_PROFILES[taskSizeKey];

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
  const rem5h = Math.max(0, Number((reserveCeiling - used5h).toFixed(1)));
  const remWeekly = Math.max(0, Number((reserveCeiling - usedWeekly).toFixed(1)));

  let mode = 'NOMINAL';
  let governingWindow = 'balanced';
  let maxFileReadLines = sizeProfile.baseMaxLines;
  let allowSubagents = taskSizeKey === 'L' || taskSizeKey === 'XL';
  let recommendedReasoningEffort = sizeProfile.nominalEffort;
  let recommendedModel = sizeProfile.nominalModel;
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
    maxFileReadLines = Math.min(80, sizeProfile.baseMaxLines);
    allowSubagents = false;
    recommendedReasoningEffort = sizeProfile.criticalEffort;
    recommendedModel = sizeProfile.criticalModel;
    testStrategy = 'typecheck-only';
    heartbeatEveryTurns = 2;
    directives = [
      'CRITICAL QUOTA: Execute P0 blocker requirements only; defer P1/P2 cleanup or secondary refactors.',
      `Use rg -n to locate exact symbols and read <= ${maxFileReadLines} lines per file via sed -n. Never read whole files.`,
      'Do NOT spawn subagents. Combine edits per file into a single patch.',
      'Layered Verification: Run Layer 1 fast static typecheck (tsc --noEmit | head -n 25) and defer heavy suites.',
    ];
  } else if (usedWeekly >= warnWeekly || (!isProExempt && used5h >= warn5h)) {
    mode = 'WARNING_CONSERVE';
    governingWindow = usedWeekly >= warnWeekly ? 'secondary_weekly_10080m' : 'primary_5h_300m';
    maxFileReadLines = Math.min(150, sizeProfile.baseMaxLines);
    allowSubagents = false;
    recommendedReasoningEffort = sizeProfile.conserveEffort;
    recommendedModel = sizeProfile.conserveModel;
    testStrategy = 'affected-unit-tests-only';
    heartbeatEveryTurns = 3;
    directives = [
      `WARNING QUOTA (Task Size ${taskSizeKey}): Conserve tokens across both 5h and weekly windows.`,
      `Prefer rg -n + targeted line ranges (<= ${maxFileReadLines} lines) over full-file reads.`,
      'Disable parallel subagents; execute sequentially with batched file edits.',
      'Layered Verification: Run Layer 1 syntax check + Layer 2 modified unit test file only (| tail -n 30).',
    ];
  } else {
    mode = 'NOMINAL';
    governingWindow = !isProExempt && used5h > usedWeekly ? 'primary_5h_300m' : 'secondary_weekly_10080m';
    if (taskSizeKey === 'XS' || taskSizeKey === 'S') {
      testStrategy = 'affected-unit-tests-only';
    }
    directives = [
      `Nominal quota headroom for Task Size ${taskSizeKey} (${sizeProfile.label}).`,
      `Recommended routing: model=${recommendedModel}, reasoning_effort=${recommendedReasoningEffort}, max_file_read_lines=${maxFileReadLines}.`,
      `Layered Verification: ${sizeProfile.verificationLayer}.`,
    ];
  }

  return {
    skill: 'codex-quota-optimizer',
    version: SKILL_VERSION,
    security_guarantee: 'offline_read_only_no_network_no_auth_access',
    plan_type: plan,
    pro_exempt_5h: isProExempt,
    task_complexity: {
      size: taskSizeKey,
      description: sizeProfile.label,
      verification_layer: sizeProfile.verificationLayer,
    },
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

function main() {
  const args = parseArgs(process.argv);

  let snapshot = findLatestRolloutSnapshot(args.codexHome, args.rolloutFile);

  if (!snapshot) {
    snapshot = {
      plan_type: args.overridePlan || 'plus',
      telemetry_status: args.override5h !== null || args.overrideWeekly !== null ? 'cli_or_env_override' : 'heuristic_fallback_no_rollout_log',
      source:
        args.override5h !== null || args.overrideWeekly !== null
          ? 'cli_or_env_override'
          : 'default_baseline (no ~/.codex/sessions rollout found; using XS-XL heuristic sizing)',
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

  const report = buildAgentQuotaReport(snapshot, { taskSize: args.taskSize });

  if (args.format === 'json') {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }

  const p = report.primary_window_5h;
  const s = report.secondary_window_weekly;
  const pol = report.optimization_policy;
  const tc = report.task_complexity;

  const banner = [
    '================================================================================',
    `[CODEX QUOTA OPTIMIZER v${SKILL_VERSION}] MODE: ${pol.mode} | TASK SIZE: ${tc.size} | PLAN: ${report.plan_type.toUpperCase()}`,
    `  • Security & Friction:     100% Offline Read-Only | Zero Network Calls | Zero Extra LLM Calls`,
    `  • 5-Hour Window (300m):    ${p.used_percent}% used (${p.remaining_effective_percent}% usable left) | Resets in ${p.resets_in_human} | Velocity: ${p.burn_velocity_ratio}x`,
    `  • Weekly Limit  (10080m):  ${s.used_percent}% used (${s.remaining_effective_percent}% usable left) | Resets in ${s.resets_in_human} | Velocity: ${s.burn_velocity_ratio}x`,
    `  • Task Routing (${tc.size}):       model=${pol.recommended_model} | reasoning_effort=${pol.recommended_reasoning_effort}`,
    `  • Agent Constraints:       max_file_read_lines=${pol.max_file_read_lines} | allow_subagents=${pol.allow_subagents} | test_strategy=${pol.test_strategy}`,
    '  • Mandatory Directives for Codex:',
    ...pol.mandatory_directives.map((d, i) => `      ${i + 1}. ${d}`),
    '================================================================================',
    JSON.stringify(report, null, 2),
  ].join('\n');

  process.stdout.write(banner + '\n');
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main();
}
