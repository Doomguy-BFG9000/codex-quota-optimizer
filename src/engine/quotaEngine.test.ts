import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateQuotaPolicy,
  optimizeTaskQueue,
  formatDurationSeconds,
  DEFAULT_THRESHOLDS,
  type CodexRateLimitSnapshot,
  type CodexTaskItem,
} from './quotaEngine';

const baseSnapshot: CodexRateLimitSnapshot = {
  plan_type: 'plus',
  primary_window: {
    window_minutes: 300,
    used_percent: 28,
    resets_in_seconds: 12600,
    resets_at_iso: '2026-11-04T18:00:00Z',
  },
  secondary_window: {
    window_minutes: 10080,
    used_percent: 34,
    resets_in_seconds: 410400,
    resets_at_iso: '2026-11-09T00:00:00Z',
  },
  source: 'rollout_jsonl',
  captured_at_iso: '2026-11-04T14:30:00Z',
};

const sampleTasks: CodexTaskItem[] = [
  {
    id: 'task-1',
    title: 'Implement rate_limit_snapshot JSONL parser in MCP server',
    category: 'feature',
    priority: 'P0',
    filesTouched: 4,
    complexity: 'high',
    baseFiveHourCostPct: 18,
    baseWeeklyCostPct: 4.5,
  },
  {
    id: 'task-2',
    title: 'Add adaptive reasoning_effort fallback middleware',
    category: 'refactor',
    priority: 'P1',
    filesTouched: 3,
    complexity: 'medium',
    baseFiveHourCostPct: 14,
    baseWeeklyCostPct: 3.2,
  },
  {
    id: 'task-3',
    title: 'Expand E2E regression tests for weekly cap exhaustion',
    category: 'test-suite',
    priority: 'P2',
    filesTouched: 6,
    complexity: 'medium',
    baseFiveHourCostPct: 22,
    baseWeeklyCostPct: 5.0,
  },
];

test('evaluateQuotaPolicy returns nominal high-reasoning policy when both 5h and weekly windows are low', () => {
  const policy = evaluateQuotaPolicy(baseSnapshot, DEFAULT_THRESHOLDS);
  assert.equal(policy.constraintState, 'nominal');
  assert.equal(policy.reasoningEffort, 'high');
  assert.equal(policy.recommendedModel, 'gpt-5-codex');
  assert.equal(policy.effectiveFiveHourRemainingPct, 67); // 100 - 28 - 5 reserve
  assert.equal(policy.effectiveWeeklyRemainingPct, 61); // 100 - 34 - 5 reserve
});

test('evaluateQuotaPolicy triggers 5h-critical when 5-hour window exceeds critical threshold on Plus plan', () => {
  const crunchSnapshot: CodexRateLimitSnapshot = {
    ...baseSnapshot,
    primary_window: {
      ...baseSnapshot.primary_window,
      used_percent: 88,
    },
  };
  const policy = evaluateQuotaPolicy(crunchSnapshot, DEFAULT_THRESHOLDS);
  assert.equal(policy.constraintState, '5h-critical');
  assert.equal(policy.governingWindow, 'primary_5h');
  assert.equal(policy.reasoningEffort, 'low');
  assert.equal(policy.recommendedModel, 'codex-mini-latest');
  assert.ok(policy.estimatedQuotaSavingsPct >= 60);
});

test('evaluateQuotaPolicy respects Pro tier 5-hour exemption while still enforcing weekly cap', () => {
  const proSnapshot: CodexRateLimitSnapshot = {
    ...baseSnapshot,
    plan_type: 'pro',
    primary_window: {
      ...baseSnapshot.primary_window,
      used_percent: 91,
    },
    secondary_window: {
      ...baseSnapshot.secondary_window,
      used_percent: 76,
    },
  };
  const policy = evaluateQuotaPolicy(proSnapshot, DEFAULT_THRESHOLDS);
  // 5h is ignored on Pro when proExemptFiveHour is true, so weekly warning (76% >= 70%) governs
  assert.equal(policy.constraintState, 'weekly-warning');
  assert.equal(policy.governingWindow, 'secondary_weekly');
  assert.equal(policy.reasoningEffort, 'medium');
});

test('optimizeTaskQueue reduces quota burn and defers tasks that would breach the 5-hour reserve', () => {
  const tightSnapshot: CodexRateLimitSnapshot = {
    ...baseSnapshot,
    primary_window: {
      ...baseSnapshot.primary_window,
      used_percent: 86,
    },
  };
  const result = optimizeTaskQueue(sampleTasks, tightSnapshot, DEFAULT_THRESHOLDS);
  assert.ok(result.totalOptimizedFiveHourPct < result.totalBaseFiveHourPct);
  assert.ok(result.projectedFiveHourEndPct <= 95); // Respects 5% reserve buffer
  assert.ok(result.tasksDeferred >= 1);
});

test('formatDurationSeconds formats days, hours, and minutes accurately', () => {
  assert.equal(formatDurationSeconds(12600), '3h 30m');
  assert.equal(formatDurationSeconds(410400), '4d 18h 0m');
  assert.equal(formatDurationSeconds(540), '9m');
});
