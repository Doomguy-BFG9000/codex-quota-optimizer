#!/usr/bin/env node
// Offline and read-only: no network or credential access.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
export const SKILL_VERSION = '0.3.0';
export const MAX_TELEMETRY_AGE_SECONDS = 900;
const validPct = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
export function formatDuration(s) {
  if (s === null || !Number.isFinite(s)) return 'unknown';
  const m = Math.floor(Math.max(0, s) / 60);
  return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor(m % 1440 / 60)}h ${m % 60}m` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
export function unknownSnapshot() {
  return { plan_type: 'unknown', source: 'missing_local_telemetry', captured_at: null, primary_window: {}, secondary_window: {} };
}
function normalizeWindow(w, minutes, captured, nowMs) {
  const age = (nowMs - Date.parse(captured)) / 1000;
  const fresh = Number.isFinite(age) && age >= -60 && age <= MAX_TELEMETRY_AGE_SECONDS;
  const reset = Number.isFinite(w?.resets_at) ? w.resets_at - nowMs / 1000 : Number.isFinite(w?.resets_in_seconds) && Number.isFinite(age) ? w.resets_in_seconds - Math.max(0, age) : null;
  const status = !w || !validPct(w.used_percent) || w.window_minutes !== minutes ? 'unknown' : !fresh || (reset !== null && reset <= 0) ? 'stale' : 'fresh';
  return { window_minutes: minutes, used_percent: status === 'fresh' ? w.used_percent : null, observed_used_percent: validPct(w?.used_percent) ? w.used_percent : null,
    resets_in_seconds: reset === null ? null : Math.max(0, Math.floor(reset)), telemetry_status: status };
}
export function parseRolloutJsonlContent(content, sourcePath = 'rollout.jsonl', nowMs = Date.now()) {
  let latest = null;
  for (const line of content.split('\n')) {
    try {
      const p = JSON.parse(line), limits = p?.payload?.rate_limits || p?.rate_limits || p?.msg?.rate_limits;
      if (!limits || (limits.limit_id && limits.limit_id !== 'codex')) continue;
      const snap = { plan_type: limits.plan_type || 'unknown', source: `rollout_jsonl (${path.basename(sourcePath)})`, captured_at: p.timestamp || null,
        primary_window: normalizeWindow(limits.primary || limits.primary_window, 300, p.timestamp, nowMs), secondary_window: normalizeWindow(limits.secondary || limits.secondary_window, 10080, p.timestamp, nowMs) };
      if (!latest || (Date.parse(snap.captured_at) || 0) >= (Date.parse(latest.captured_at) || 0)) latest = snap;
    } catch { /* tolerate malformed and partially written lines */ }
  }
  return latest;
}
export function findLatestRolloutSnapshot(codexHome, explicitFile = null) {
  const read = f => { try { return parseRolloutJsonlContent(fs.readFileSync(f, 'utf8'), f); } catch { return null; } };
  if (explicitFile) return read(explicitFile);
  const files = [];
  function walk(dir) {
    try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) files.push(full);
    } } catch { /* unavailable telemetry remains unknown */ }
  }
  walk(path.join(codexHome, 'sessions'));
  let latest = null;
  for (const f of files) { const snap = read(f); if (snap && (!latest || (Date.parse(snap.captured_at) || 0) > (Date.parse(latest.captured_at) || 0))) latest = snap; }
  return latest;
}
export function buildAgentQuotaReport(raw = unknownSnapshot(), options = {}) {
  const threshold = (key, env, fallback) => {
    const value = Number(options[key] ?? process.env[env] ?? fallback);
    return validPct(value) ? value : fallback;
  };
  const warn5h = threshold('warn5h', 'CODEX_QUOTA_FIVE_HOUR_WARN', 65);
  const crit5h = threshold('crit5h', 'CODEX_QUOTA_FIVE_HOUR_CRIT', 85);
  const warnWeekly = threshold('warnWeekly', 'CODEX_QUOTA_WEEKLY_WARN', 70);
  const critWeekly = threshold('critWeekly', 'CODEX_QUOTA_WEEKLY_CRIT', 88);
  const size = ['XS', 'S', 'M', 'L', 'XL'].includes(options.taskSize) ? options.taskSize : 'M';
  const reserve = Number(options.reservePct ?? process.env.CODEX_QUOTA_RESERVE_PCT ?? 5);
  const ceiling = Number.isFinite(reserve) ? Math.min(95, Math.max(0, 100 - reserve)) : 95;
  function windowReport(w, minutes) {
    const used = validPct(w?.used_percent) ? w.used_percent : null, reset = Number.isFinite(w?.resets_in_seconds) ? Math.max(0, w.resets_in_seconds) : null;
    return { window_minutes: minutes, used_percent: used, telemetry_status: w?.telemetry_status || (used === null ? 'unknown' : 'provided'), observed_used_percent: w?.observed_used_percent ?? used,
      remaining_effective_percent: used === null ? null : Math.max(0, +(ceiling - used).toFixed(1)), resets_in_seconds: reset, resets_in_human: formatDuration(reset),
      burn_velocity_ratio: used === null || reset === null ? null : +(used / Math.max(2, (1 - reset / (minutes * 60)) * 100)).toFixed(2) };
  }
  const p = windowReport(raw.primary_window, 300), s = windowReport(raw.secondary_window, 10080), unknown = p.used_percent === null || s.used_percent === null;
  const mode = (p.used_percent !== null && p.used_percent >= ceiling) || (s.used_percent !== null && s.used_percent >= ceiling) ? 'RESERVE_STOP' : unknown ? 'TELEMETRY_UNKNOWN'
    : p.used_percent >= crit5h || s.used_percent >= critWeekly ? 'CRITICAL_SURGICAL' : p.used_percent >= warn5h || s.used_percent >= warnWeekly ? 'WARNING_CONSERVE' : 'NOMINAL';
  const model = size === 'XS' || size === 'S' ? 'gpt-6-luna' : 'gpt-6.1-sol';
  return { skill: 'codex-quota-optimizer', version: SKILL_VERSION, security_guarantee: 'offline_read_only_no_network_no_auth_access', plan_type: raw.plan_type || 'unknown', pro_exempt_5h: false,
    source: raw.source, captured_at: raw.captured_at, reserve_ceiling_percent: ceiling, telemetry_status: unknown ? 'unknown_or_stale' : raw.source === 'cli_or_env_override' ? 'manual_override' : 'fresh_local_observation',
    task_complexity: { size, description: 'Task sizing heuristic; verify model availability in your client.' }, primary_window_5h: p, secondary_window_weekly: s,
    optimization_policy: { mode, governing_window: s.used_percent >= 70 ? 'secondary_weekly_10080m' : 'primary_5h_300m', recommended_model: model,
      recommended_reasoning_effort: model === 'gpt-6-luna' ? 'high' : size === 'XL' ? 'high' : 'medium',
      max_file_read_lines: mode === 'RESERVE_STOP' ? 0 : mode === 'CRITICAL_SURGICAL' ? 80 : mode === 'NOMINAL' ? 400 : 150,
      allow_subagents: mode === 'NOMINAL' && ['L', 'XL'].includes(size), test_strategy: mode === 'RESERVE_STOP' ? 'checkpoint' : mode === 'CRITICAL_SURGICAL' ? 'typecheck-only' : 'affected-unit-tests-only', heartbeat_every_turns: mode === 'NOMINAL' ? 5 : 2,
      mandatory_directives: [mode === 'RESERVE_STOP' ? 'Stop starting work; write CODEX_CHECKPOINT.md with remaining steps and known reset times.' : unknown ? 'Quota headroom is unknown. Use task sizing only; refresh telemetry before quota-budgeted scheduling.' : 'Recheck both windows between tasks. Cost multipliers are planning heuristics, not guaranteed savings.'] } };
}
export function loadQuotaReport(argv = process.argv) {
  const args = Object.fromEntries(argv.slice(2).filter(a => a.startsWith('--') && a.includes('=')).map(a => { const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)]; }));
  const raw = findLatestRolloutSnapshot(args['codex-home'] || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), args['rollout-file']) || unknownSnapshot();
  for (const [key, flag, env, resetEnv] of [['primary_window', '5h', 'CODEX_PRIMARY_USED_PCT', 'CODEX_PRIMARY_RESET_SEC'], ['secondary_window', 'weekly', 'CODEX_WEEKLY_USED_PCT', 'CODEX_WEEKLY_RESET_SEC']]) {
    const value = args[flag] ?? process.env[env];
    if (value !== undefined) {
      if (value.trim() === '' || !validPct(Number(value))) throw new Error('Usage overrides must be finite percentages from 0 to 100');
      const reset = args[`${flag}-reset-sec`] ?? process.env[resetEnv];
      if (reset !== undefined && (!Number.isFinite(Number(reset)) || Number(reset) < 0)) throw new Error('Invalid reset seconds');
      raw[key] = { used_percent: Number(value), resets_in_seconds: reset === undefined ? null : Number(reset), telemetry_status: 'manual_override' }; raw.source = 'cli_or_env_override';
    }
  }
  raw.plan_type = args.plan || process.env.CODEX_PLAN_TYPE || raw.plan_type;
  return buildAgentQuotaReport(raw, { taskSize: args['task-size'] || process.env.CODEX_TASK_SIZE });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const report = loadQuotaReport(); if (!process.argv.includes('--format=json')) console.log(`[CODEX QUOTA OPTIMIZER] MODE: ${report.optimization_policy.mode}`); console.log(JSON.stringify(report, null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
