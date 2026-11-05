import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentQuotaReport, parseRolloutJsonlContent, unknownSnapshot } from '../skills/codex-quota-optimizer/scripts/check_quota.mjs';
import { scheduleTasksAgainstQuota } from '../skills/codex-quota-optimizer/scripts/optimize_work_plan.mjs';

// Fixed clock and synthetic observations keep the demonstration reproducible.
// No local sessions are read and no model calls or network requests are made.
const now = Date.parse('2026-11-05T00:00:00Z');
const tasks = [{ title: 'Fix parser', priority: 'P0', est_5h_pct: 10, est_weekly_pct: 2 }];
const options = { taskSize: 'M', reservePct: 5, warn5h: 65, crit5h: 85, warnWeekly: 70, critWeekly: 88 };
function observation(primary, secondary, timestamp = new Date(now).toISOString()) {
  const event = { timestamp, payload: { rate_limits: {
    primary: { used_percent: primary, window_minutes: 300, resets_in_seconds: 4200 },
    secondary: { used_percent: secondary, window_minutes: 10080, resets_in_seconds: 259200 },
  } } };
  return parseRolloutJsonlContent(JSON.stringify(event), 'synthetic-demo.jsonl', now);
}
export function buildDemo() {
  const cases = [
    ['Fresh observation', observation(32, 41), 'NOMINAL', 'EXECUTE_FULL'],
    ['Too close to reserve', observation(91.4, 58), 'CRITICAL_SURGICAL', 'DEFER_UNTIL_RESET'],
    ['Missing telemetry', unknownSnapshot(), 'TELEMETRY_UNKNOWN', 'DEFER_UNTIL_RESET'],
    ['Stale observation', observation(32, 41, '2026-11-04T23:00:00Z'), 'TELEMETRY_UNKNOWN', 'DEFER_UNTIL_RESET'],
    ['Reserve reached', observation(95, 58), 'RESERVE_STOP', 'DEFER_UNTIL_RESET'],
  ];
  const lines = ['codex-quota-optimizer | reproducible behavior demo',
    'Synthetic inputs. No Codex calls, local sessions, or credentials.', ''];
  for (const [label, snapshot, expectedMode, expectedAction] of cases) {
    const report = buildAgentQuotaReport(snapshot, options);
    const plan = scheduleTasksAgainstQuota(tasks, report);
    assert.equal(report.optimization_policy.mode, expectedMode);
    assert.equal(plan.schedule[0].action, expectedAction);
    if (report.primary_window_5h.used_percent !== null) assert.ok(plan.projected_final_5h_used_pct <= 95);
    const show = value => value === null ? 'unknown' : `${value}%`;
    lines.push(label,
      `  5h ${show(report.primary_window_5h.used_percent)} | weekly ${show(report.secondary_window_weekly.used_percent)} | ${report.optimization_policy.mode}`,
      `  ${plan.schedule[0].action} | projected 5h ${show(plan.projected_final_5h_used_pct)}`, '');
  }
  lines.push('PASS: all 5 behavior checks. Actual quota savings: not measured.');
  return lines.join('\n');
}
function writePreview(transcript) {
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const lines = transcript.split('\n');
  const height = 86 + lines.length * 25;
  const rows = lines.map((line, i) => {
    const color = line.startsWith('PASS') ? '#86efac' : line.startsWith('  ') ? '#cbd5e1' : '#f8fafc';
    return `<text x="28" y="${78 + i * 25}" fill="${color}" xml:space="preserve">${escape(line)}</text>`;
  }).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="${height}" viewBox="0 0 1120 ${height}" role="img" aria-labelledby="title desc">
<title id="title">Offline quota behavior demonstration</title>
<desc id="desc">Generated terminal preview with synthetic inputs: fresh, near-reserve, missing, stale, and stopped quota states. This is not a savings benchmark.</desc>
<rect width="1120" height="${height}" rx="14" fill="#0f172a"/>
<path d="M0 44H1120" stroke="#334155"/>
<circle cx="28" cy="23" r="6" fill="#fb7185"/><circle cx="49" cy="23" r="6" fill="#fbbf24"/><circle cx="70" cy="23" r="6" fill="#4ade80"/>
<g font-family="Consolas, Menlo, monospace" font-size="17">${rows}</g>
</svg>\n`;
  const target = new URL('../docs/assets/demo.svg', import.meta.url);
  fs.mkdirSync(new URL('../docs/assets/', import.meta.url), {recursive:true});
  fs.writeFileSync(target, svg);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const transcript = buildDemo();
  if (process.argv.includes('--write-preview')) writePreview(transcript);
  console.log(transcript);
}
