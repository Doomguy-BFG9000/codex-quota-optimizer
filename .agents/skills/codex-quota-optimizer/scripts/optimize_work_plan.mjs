#!/usr/bin/env node
/**
 * OpenAI Codex Skill Script: optimize_work_plan.mjs
 *
 * Accepts a JSON array of subtasks that Codex plans to execute and schedules/throttles
 * each subtask against the remaining 5-hour (`primary_window`) and 7-day weekly
 * (`secondary_window`) quota using estimated costs; actual server limits may differ.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuotaReport } from './check_quota.mjs';

export function scheduleTasksAgainstQuota(tasks, quotaReport) {
  const ceiling = quotaReport.reserve_ceiling_percent;
  const reserveCeiling = Number.isFinite(ceiling) ? Math.min(95, Math.max(0, ceiling)) : 95;
  const isProExempt = false;

  let running5h = quotaReport.primary_window_5h.used_percent;
  let runningWeekly = quotaReport.secondary_window_weekly.used_percent;
  const baseMode = quotaReport.optimization_policy.mode;

  if (!Array.isArray(tasks)) throw new Error('Tasks must be an array');
  const telemetryUnknown = !Number.isFinite(running5h) || !Number.isFinite(runningWeekly);
  const priorityRank = { P0: 0, P1: 1, P2: 2 };
  const sorted = [...tasks].sort(
    (a, b) => (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1)
  );

  let unoptimized5hTotal = 0;
  let optimized5hTotal = 0;

  const schedule = sorted.map((t, index) => {
    const base5h = Number(t.est_5h_pct ?? 10);
    const baseWeekly = Number(t.est_weekly_pct ?? (base5h * 0.24).toFixed(1));
    if (!Number.isFinite(base5h) || base5h < 0 || !Number.isFinite(baseWeekly) || baseWeekly < 0) throw new Error('Task estimates must be finite and nonnegative');
    unoptimized5hTotal += base5h;

    const rem5h = isProExempt ? 100 : Math.max(0, reserveCeiling - running5h);
    const remWeekly = Math.max(0, reserveCeiling - runningWeekly);

    let action = 'EXECUTE_FULL';
    let costMultiplier = 0.88;
    let maxReadLines = 400;
    let verification = 'run-affected-unit-tests';
    let rationale = 'Sufficient 5h & weekly headroom; execute full agentic loop.';

    if (
      telemetryUnknown || baseMode === 'RESERVE_STOP' ||
      remWeekly < baseWeekly * 0.35 ||
      (!isProExempt && rem5h < base5h * 0.35)
    ) {
      action = 'DEFER_UNTIL_RESET';
      costMultiplier = 0;
      maxReadLines = 0;
      verification = 'skip-and-record-in-checkpoint';
      rationale = `Deferred: Executing "${t.title}" would breach the 95% safety reserve (5h at ${running5h?.toFixed(1) ?? 'unknown'}%, weekly at ${runningWeekly?.toFixed(1) ?? 'unknown'}%).`;
    } else if (
      baseMode === 'CRITICAL_SURGICAL' ||
      t.priority === 'P2' ||
      (!isProExempt && rem5h < base5h * 0.9)
    ) {
      action = 'EXECUTE_MINIMAL_DIFF';
      costMultiplier = 0.38;
      maxReadLines = 80;
      verification = 'static-typecheck-only';
      rationale = 'Low-token surgical patch: use rg + sed line slices (<=80 lines), single patch edit, and tsc --noEmit.';
    } else if (
      baseMode === 'WARNING_CONSERVE' ||
      t.priority === 'P1' ||
      (!isProExempt && rem5h < base5h * 1.5)
    ) {
      action = 'EXECUTE_COMPACT';
      costMultiplier = 0.62;
      maxReadLines = 150;
      verification = 'single-file-unit-test';
      rationale = 'Compact execution: read <=150 lines per file, disable subagents, run single test file only.';
    }

    let opt5h = Number((base5h * costMultiplier).toFixed(1));
    let optWeekly = Number((baseWeekly * costMultiplier).toFixed(1));

    if (action !== 'DEFER_UNTIL_RESET' && (running5h >= reserveCeiling || runningWeekly >= reserveCeiling || running5h + opt5h > reserveCeiling || runningWeekly + optWeekly > reserveCeiling)) {
      action = 'DEFER_UNTIL_RESET'; opt5h = 0; optWeekly = 0; maxReadLines = 0; verification = 'skip-and-record-in-checkpoint';
      rationale = 'Deferred: selected execution cost would exceed the reserve in at least one window.';
    }
    if (telemetryUnknown) rationale = 'Deferred: quota headroom is unknown or stale; refresh telemetry.';
    if (action !== 'DEFER_UNTIL_RESET') {
      running5h = Number(Math.min(100, running5h + opt5h).toFixed(1));
      runningWeekly = Number(Math.min(100, runningWeekly + optWeekly).toFixed(1));
      optimized5hTotal = Number((optimized5hTotal + opt5h).toFixed(1));
    }

    return {
      step: index + 1,
      id: t.id || `step-${index + 1}`,
      title: t.title,
      priority: t.priority || 'P1',
      action,
      max_file_read_lines: maxReadLines,
      verification,
      estimated_5h_burn_pct: opt5h,
      unoptimized_5h_burn_pct: base5h,
      projected_5h_used_after_pct: running5h,
      projected_weekly_used_after_pct: runningWeekly,
      rationale,
    };
  });

  return {
    telemetry_status: quotaReport.telemetry_status,
    reserve_ceiling_percent: reserveCeiling,
    initial_5h_used_pct: quotaReport.primary_window_5h.used_percent,
    initial_weekly_used_pct: quotaReport.secondary_window_weekly.used_percent,
    unoptimized_total_5h_burn_pct: Number(unoptimized5hTotal.toFixed(1)),
    optimized_total_5h_burn_pct: optimized5hTotal,
    projected_final_5h_used_pct: running5h,
    projected_final_weekly_used_pct: runningWeekly,
    schedule,
  };
}

function main() {
  const argv = process.argv.slice(2);
  let tasksJson = null;

  for (const arg of argv) {
    if (arg.startsWith('--tasks=')) tasksJson = arg.slice('--tasks='.length);
  }

  const defaultTasks = [
    { id: '1', title: 'Locate target modules & inspect types', priority: 'P0', est_5h_pct: 6 },
    { id: '2', title: 'Implement core fix / feature changes', priority: 'P0', est_5h_pct: 14 },
    { id: '3', title: 'Refactor helper utilities & cleanup', priority: 'P1', est_5h_pct: 12 },
    { id: '4', title: 'Run regression & integration suite', priority: 'P2', est_5h_pct: 18 },
  ];

  let parsedTasks = defaultTasks;
  if (tasksJson) {
    try {
      parsedTasks = JSON.parse(tasksJson);
    } catch {
      throw new Error('Invalid tasks JSON');
    }
  }

  const report = loadQuotaReport();
  const plan = scheduleTasksAgainstQuota(parsedTasks, report);

  process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
