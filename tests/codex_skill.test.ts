import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHECK_QUOTA_SCRIPT = path.resolve('skills/codex-quota-optimizer/scripts/check_quota.mjs');
const OPTIMIZE_PLAN_SCRIPT = path.resolve('skills/codex-quota-optimizer/scripts/optimize_work_plan.mjs');

test('SKILL.md, README.md, CHANGELOG.md, and LICENSE have v0.3.0 metadata and zero placeholders', () => {
  const skillMd = fs.readFileSync(path.resolve('skills/codex-quota-optimizer/SKILL.md'), 'utf8');
  assert.ok(skillMd.includes('name: codex-quota-optimizer'));
  assert.ok(skillMd.includes('version: 0.3.0'));
  assert.ok(skillMd.includes('Thlookingatyou/codex-quota-optimizer'));

  const readmeMd = fs.readFileSync(path.resolve('README.md'), 'utf8');
  assert.ok(readmeMd.includes('Thlookingatyou/codex-quota-optimizer'));
  assert.ok(!readmeMd.includes('<your-username>'), 'README.md must not contain <your-username> placeholder');
  assert.ok(readmeMd.includes('npx skills add Thlookingatyou/codex-quota-optimizer'));

  const changelogMd = fs.readFileSync(path.resolve('CHANGELOG.md'), 'utf8');
  assert.ok(changelogMd.includes('## [0.3.0]'));

  const licenseTxt = fs.readFileSync(path.resolve('LICENSE'), 'utf8');
  assert.ok(licenseTxt.includes('MIT License'));
  assert.ok(licenseTxt.includes('Thlookingatyou'));
});

test('check_quota.mjs is 100% offline and never accesses auth.json or fetch()', () => {
  const scriptSource = fs.readFileSync(CHECK_QUOTA_SCRIPT, 'utf8');
  assert.ok(!scriptSource.includes('fetch('), 'check_quota.mjs must not make network fetch calls');
  assert.ok(!scriptSource.includes('wham/usage'), 'check_quota.mjs must not call external wham endpoint');
  assert.ok(!scriptSource.includes("path.join(codexHome, 'auth.json')"), 'check_quota.mjs must not read auth.json');
});

test('check_quota.mjs supports XS-XL task complexity sizing and parses rollout-*.jsonl', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
  const sessionDir = path.join(tmpDir, 'sessions', '2026', '11', '04');
  fs.mkdirSync(sessionDir, { recursive: true });

  const rolloutLine = JSON.stringify({
    timestamp: new Date().toISOString(),
    type: 'event_msg',
    payload: {
      type: 'token_count',
      rate_limits: {
        plan_type: 'plus',
        primary: {
          used_percent: 87.5,
          window_minutes: 300,
          resets_in_seconds: 4200,
        },
        secondary: {
          used_percent: 58.0,
          window_minutes: 10080,
          resets_in_seconds: 259200,
        },
      },
    },
  });

  fs.writeFileSync(path.join(sessionDir, 'rollout-test.jsonl'), rolloutLine + '\n', 'utf8');

  const stdout = execFileSync(
    'node',
    [CHECK_QUOTA_SCRIPT, `--codex-home=${tmpDir}`, '--task-size=XS', '--format=json'],
    { encoding: 'utf8' }
  );

  const report = JSON.parse(stdout);
  assert.equal(report.version, '0.3.0');
  assert.equal(report.security_guarantee, 'offline_read_only_no_network_no_auth_access');
  assert.equal(report.task_complexity.size, 'XS');
  assert.equal(report.primary_window_5h.used_percent, 87.5);
  assert.equal(report.secondary_window_weekly.used_percent, 58.0);
  assert.equal(report.optimization_policy.mode, 'CRITICAL_SURGICAL');
  assert.equal(report.optimization_policy.allow_subagents, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('optimize_work_plan.mjs throttles and defers tasks when 5-hour quota is critical', () => {
  const tasksArg = JSON.stringify([
    { id: '1', title: 'Fix P0 production crash', priority: 'P0', est_5h_pct: 12 },
    { id: '2', title: 'Refactor logging helpers', priority: 'P1', est_5h_pct: 15 },
    { id: '3', title: 'Run full E2E browser suite', priority: 'P2', est_5h_pct: 20 },
  ]);

  const stdout = execFileSync(
    'node',
    [OPTIMIZE_PLAN_SCRIPT, `--tasks=${tasksArg}`, '--5h=88', '--weekly=45'],
    { encoding: 'utf8' }
  );

  const plan = JSON.parse(stdout);
  assert.equal(plan.initial_5h_used_pct, 88);
  assert.ok(plan.projected_final_5h_used_pct <= 95);
  assert.equal(plan.schedule[0].action, 'EXECUTE_MINIMAL_DIFF');
  assert.equal(plan.schedule[2].action, 'DEFER_UNTIL_RESET');
});
