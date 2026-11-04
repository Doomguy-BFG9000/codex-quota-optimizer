import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHECK_QUOTA_SCRIPT = path.resolve('skills/codex-quota-optimizer/scripts/check_quota.mjs');
const OPTIMIZE_PLAN_SCRIPT = path.resolve('skills/codex-quota-optimizer/scripts/optimize_work_plan.mjs');

test('SKILL.md and agents/openai.yaml exist and follow OpenAI Codex skill structure', () => {
  const skillMd = fs.readFileSync(path.resolve('skills/codex-quota-optimizer/SKILL.md'), 'utf8');
  assert.ok(skillMd.startsWith('---\nname: codex-quota-optimizer\ndescription:'));
  assert.ok(skillMd.includes('check_quota.mjs'));
  assert.ok(skillMd.includes('optimize_work_plan.mjs'));

  const openaiYaml = fs.readFileSync(
    path.resolve('skills/codex-quota-optimizer/agents/openai.yaml'),
    'utf8'
  );
  assert.ok(openaiYaml.includes('display_name: "Codex Quota Optimizer"'));
  assert.ok(openaiYaml.includes('$codex-quota-optimizer'));
  assert.ok(openaiYaml.includes('allow_implicit_invocation: true'));
});

test('check_quota.mjs parses a real OpenAI Codex rollout-*.jsonl rate_limits event', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-test-'));
  const sessionDir = path.join(tmpDir, 'sessions', '2026', '11', '04');
  fs.mkdirSync(sessionDir, { recursive: true });

  const rolloutLine = JSON.stringify({
    timestamp: '2026-11-04T14:22:19.401Z',
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
    [CHECK_QUOTA_SCRIPT, `--codex-home=${tmpDir}`, '--format=json'],
    { encoding: 'utf8' }
  );

  const report = JSON.parse(stdout);
  assert.equal(report.primary_window_5h.used_percent, 87.5);
  assert.equal(report.primary_window_5h.window_minutes, 300);
  assert.equal(report.secondary_window_weekly.used_percent, 58.0);
  assert.equal(report.secondary_window_weekly.window_minutes, 10080);
  assert.equal(report.optimization_policy.mode, 'CRITICAL_SURGICAL');
  assert.equal(report.optimization_policy.allow_subagents, false);
  assert.equal(report.optimization_policy.max_file_read_lines, 80);

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
