export type CodexPlanTier = 'plus' | 'pro' | 'team' | 'enterprise';

export type ReasoningEffort = 'high' | 'medium' | 'low';

export type RecommendedModel =
  | 'gpt-6.1-sol'
  | 'gpt-6-luna';

export type ExecutionMode =
  | 'full-agentic'
  | 'compact-surgical'
  | 'mini-model-batch'
  | 'defer-until-5h-reset';

export type QuotaConstraintState =
  | 'nominal'
  | '5h-warning'
  | '5h-critical'
  | 'weekly-warning'
  | 'weekly-critical'
  | 'exhausted';

export interface RateLimitWindow {
  window_minutes: number; // 300 for 5-hour primary, 10080 for 7-day weekly secondary
  used_percent: number; // 0 to 100
  resets_in_seconds: number;
  resets_at_iso: string;
}

export interface CodexRateLimitSnapshot {
  plan_type: CodexPlanTier;
  primary_window: RateLimitWindow; // 5-hour rolling burst limit (300 mins)
  secondary_window: RateLimitWindow; // 7-day weekly cap (10080 mins)
  source: 'rollout_jsonl' | 'wham_usage_api' | 'response_headers';
  captured_at_iso: string;
}

export interface PolicyThresholds {
  fiveHourWarningPct: number; // default 65
  fiveHourCriticalPct: number; // default 85
  weeklyWarningPct: number; // default 70
  weeklyCriticalPct: number; // default 88
  reserveBufferPct: number; // default 5 (never let a single task hit 100%)
  proExemptFiveHour: boolean; // Deprecated compatibility field; reported limits always apply
}

export interface WorkOptimizationPolicy {
  constraintState: QuotaConstraintState;
  governingWindow: 'primary_5h' | 'secondary_weekly' | 'balanced';
  effectiveFiveHourRemainingPct: number;
  effectiveWeeklyRemainingPct: number;
  fiveHourBurnRatio: number; // > 1.0 means burning faster than linear 5h clock
  weeklyBurnRatio: number; // > 1.0 means burning faster than linear 7d clock
  reasoningEffort: ReasoningEffort;
  recommendedModel: RecommendedModel;
  maxContextTokens: number;
  subagentConcurrency: number;
  testVerificationMode: 'full-suite' | 'affected-only' | 'syntax-and-typecheck' | 'defer-heavy-suites';
  contextCompactionTriggerPct: number;
  estimatedQuotaSavingsPct: number;
  directives: string[];
}

export interface CodexTaskItem {
  id: string;
  title: string;
  category: 'feature' | 'refactor' | 'bugfix' | 'test-suite' | 'docs';
  priority: 'P0' | 'P1' | 'P2';
  filesTouched: number;
  complexity: 'low' | 'medium' | 'high';
  baseFiveHourCostPct: number;
  baseWeeklyCostPct: number;
}

export interface OptimizedTaskPlanItem extends CodexTaskItem {
  executionMode: ExecutionMode;
  assignedModel: RecommendedModel;
  assignedReasoning: ReasoningEffort;
  optimizedFiveHourCostPct: number;
  optimizedWeeklyCostPct: number;
  cumulativeFiveHourPct: number;
  cumulativeWeeklyPct: number;
  actionSummary: string;
  willFitCurrentWindow: boolean;
}

export interface TaskQueueOptimizationResult {
  items: OptimizedTaskPlanItem[];
  totalBaseFiveHourPct: number;
  totalOptimizedFiveHourPct: number;
  totalBaseWeeklyPct: number;
  totalOptimizedWeeklyPct: number;
  tasksCompletedInWindow: number;
  tasksDeferred: number;
  projectedFiveHourEndPct: number;
  projectedWeeklyEndPct: number;
}

export const DEFAULT_THRESHOLDS: PolicyThresholds = {
  fiveHourWarningPct: 65,
  fiveHourCriticalPct: 85,
  weeklyWarningPct: 70,
  weeklyCriticalPct: 88,
  reserveBufferPct: 5,
  proExemptFiveHour: false,
};

function reserveCeiling(reserve: number): number {
  return Number.isFinite(reserve) ? Math.min(95, Math.max(0, 100 - reserve)) : 95;
}

function clampPct(val: number): number {
  if (!Number.isFinite(val)) throw new Error('Simulator requires finite percentages');
  return Math.max(0, Math.min(100, Math.round(val * 10) / 10));
}

/**
 * Evaluates an OpenAI Codex `rate_limit_snapshot` (both 5-hour primary_window
 * and 7-day weekly secondary_window) and computes the optimal work policy.
 */
export function evaluateQuotaPolicy(
  snapshot: CodexRateLimitSnapshot,
  thresholds: PolicyThresholds = DEFAULT_THRESHOLDS
): WorkOptimizationPolicy {
  const primaryUsed = clampPct(snapshot.primary_window.used_percent);
  const secondaryUsed = clampPct(snapshot.secondary_window.used_percent);

  const isProExempt = false; // Plan labels do not exempt reported limits.

  const rawFiveHourRemaining = Math.max(0, 100 - primaryUsed - thresholds.reserveBufferPct);
  const effectiveFiveHourRemainingPct = isProExempt
    ? Math.max(rawFiveHourRemaining, reserveCeiling(thresholds.reserveBufferPct))
    : rawFiveHourRemaining;

  const effectiveWeeklyRemainingPct = Math.max(
    0,
    100 - secondaryUsed - thresholds.reserveBufferPct
  );

  // Calculate elapsed window fraction to measure burn rate velocity
  const primaryTotalSec = Math.max(1, snapshot.primary_window.window_minutes * 60);
  const primaryElapsedSec = Math.max(
    60,
    primaryTotalSec - Math.min(primaryTotalSec, snapshot.primary_window.resets_in_seconds)
  );
  const primaryElapsedPct = (primaryElapsedSec / primaryTotalSec) * 100;
  const fiveHourBurnRatio = Number((primaryUsed / Math.max(5, primaryElapsedPct)).toFixed(2));

  const secondaryTotalSec = Math.max(1, snapshot.secondary_window.window_minutes * 60);
  const secondaryElapsedSec = Math.max(
    300,
    secondaryTotalSec - Math.min(secondaryTotalSec, snapshot.secondary_window.resets_in_seconds)
  );
  const secondaryElapsedPct = (secondaryElapsedSec / secondaryTotalSec) * 100;
  const weeklyBurnRatio = Number((secondaryUsed / Math.max(2, secondaryElapsedPct)).toFixed(2));

  // Determine constraint state
  let constraintState: QuotaConstraintState = 'nominal';
  let governingWindow: 'primary_5h' | 'secondary_weekly' | 'balanced' = 'balanced';

  if (
    (!isProExempt && primaryUsed >= reserveCeiling(thresholds.reserveBufferPct)) ||
    secondaryUsed >= reserveCeiling(thresholds.reserveBufferPct)
  ) {
    constraintState = 'exhausted';
    governingWindow =
      secondaryUsed >= reserveCeiling(thresholds.reserveBufferPct) ? 'secondary_weekly' : 'primary_5h';
  } else if (secondaryUsed >= thresholds.weeklyCriticalPct) {
    constraintState = 'weekly-critical';
    governingWindow = 'secondary_weekly';
  } else if (!isProExempt && primaryUsed >= thresholds.fiveHourCriticalPct) {
    constraintState = '5h-critical';
    governingWindow = 'primary_5h';
  } else if (secondaryUsed >= thresholds.weeklyWarningPct) {
    constraintState = 'weekly-warning';
    governingWindow = 'secondary_weekly';
  } else if (!isProExempt && primaryUsed >= thresholds.fiveHourWarningPct) {
    constraintState = '5h-warning';
    governingWindow = 'primary_5h';
  } else {
    constraintState = 'nominal';
    governingWindow =
      !isProExempt && primaryUsed > secondaryUsed ? 'primary_5h' : 'secondary_weekly';
  }

  // Map state to concrete Codex execution parameters
  switch (constraintState) {
    case 'exhausted':
      return {
        constraintState,
        governingWindow,
        effectiveFiveHourRemainingPct: clampPct(effectiveFiveHourRemainingPct),
        effectiveWeeklyRemainingPct: clampPct(effectiveWeeklyRemainingPct),
        fiveHourBurnRatio,
        weeklyBurnRatio,
        reasoningEffort: 'low',
        recommendedModel: 'gpt-6-luna',
        maxContextTokens: 8000,
        subagentConcurrency: 0,
        testVerificationMode: 'defer-heavy-suites',
        contextCompactionTriggerPct: 20,
        estimatedQuotaSavingsPct: 78,
        directives: [
          'Quota reserve threshold reached: serialize dirty state to git wip branch immediately.',
          'Suspend multi-turn exploratory file reads and subagent spawning.',
          'Emit structured handoff summary in AGENTS.checkpoint.md for post-reset resumption.',
        ],
      };

    case 'weekly-critical':
      return {
        constraintState,
        governingWindow,
        effectiveFiveHourRemainingPct: clampPct(effectiveFiveHourRemainingPct),
        effectiveWeeklyRemainingPct: clampPct(effectiveWeeklyRemainingPct),
        fiveHourBurnRatio,
        weeklyBurnRatio,
        reasoningEffort: 'low',
        recommendedModel: 'gpt-6-luna',
        maxContextTokens: 16000,
        subagentConcurrency: 1,
        testVerificationMode: 'syntax-and-typecheck',
        contextCompactionTriggerPct: 30,
        estimatedQuotaSavingsPct: 68,
        directives: [
          'Weekly 7-day cap is critical: route routine edits and boilerplate to gpt-6-luna.',
          'Restrict reasoning_effort="low" and cap file reads to exact line ranges (sed/ripgrep).',
          'Defer non-P0 refactors and full integration test loops until weekly billing reset.',
        ],
      };

    case '5h-critical':
      return {
        constraintState,
        governingWindow,
        effectiveFiveHourRemainingPct: clampPct(effectiveFiveHourRemainingPct),
        effectiveWeeklyRemainingPct: clampPct(effectiveWeeklyRemainingPct),
        fiveHourBurnRatio,
        weeklyBurnRatio,
        reasoningEffort: 'low',
        recommendedModel: 'gpt-6-luna',
        maxContextTokens: 20000,
        subagentConcurrency: 1,
        testVerificationMode: 'syntax-and-typecheck',
        contextCompactionTriggerPct: 35,
        estimatedQuotaSavingsPct: 62,
        directives: [
          '5-hour rolling window above critical threshold: switch to surgical line-range diffs.',
          'Trigger immediate /compact on conversation history exceeding 20k tokens.',
          'Run fast tsc --noEmit verification instead of full E2E browser suites until 5h window resets.',
        ],
      };

    case 'weekly-warning':
      return {
        constraintState,
        governingWindow,
        effectiveFiveHourRemainingPct: clampPct(effectiveFiveHourRemainingPct),
        effectiveWeeklyRemainingPct: clampPct(effectiveWeeklyRemainingPct),
        fiveHourBurnRatio,
        weeklyBurnRatio,
        reasoningEffort: 'medium',
        recommendedModel: 'gpt-6.1-sol',
        maxContextTokens: 42000,
        subagentConcurrency: 2,
        testVerificationMode: 'affected-only',
        contextCompactionTriggerPct: 50,
        estimatedQuotaSavingsPct: 41,
        directives: [
          'Weekly burn rate elevated: step down reasoning_effort from high to medium.',
          'Prefer ripgrep symbol lookups over whole-file ingestion to conserve weekly token pool.',
          'Execute unit tests only on modified modules rather than workspace-wide test runs.',
        ],
      };

    case '5h-warning':
      return {
        constraintState,
        governingWindow,
        effectiveFiveHourRemainingPct: clampPct(effectiveFiveHourRemainingPct),
        effectiveWeeklyRemainingPct: clampPct(effectiveWeeklyRemainingPct),
        fiveHourBurnRatio,
        weeklyBurnRatio,
        reasoningEffort: 'medium',
        recommendedModel: 'gpt-6.1-sol',
        maxContextTokens: 48000,
        subagentConcurrency: 2,
        testVerificationMode: 'affected-only',
        contextCompactionTriggerPct: 55,
        estimatedQuotaSavingsPct: 36,
        directives: [
          '5-hour burst window entering warning zone: batch file edits into single turn patches.',
          'Limit parallel MCP tool calls to 2 concurrent workers.',
          'Prune verbose test stdout logs before appending to agent context.',
        ],
      };

    case 'nominal':
    default:
      return {
        constraintState: 'nominal',
        governingWindow,
        effectiveFiveHourRemainingPct: clampPct(effectiveFiveHourRemainingPct),
        effectiveWeeklyRemainingPct: clampPct(effectiveWeeklyRemainingPct),
        fiveHourBurnRatio,
        weeklyBurnRatio,
        reasoningEffort: 'high',
        recommendedModel: 'gpt-6.1-sol',
        maxContextTokens: 128000,
        subagentConcurrency: 4,
        testVerificationMode: 'full-suite',
        contextCompactionTriggerPct: 80,
        estimatedQuotaSavingsPct: 12,
        directives: [
          'Both 5-hour and weekly windows nominal: full high-reasoning architecture & verification enabled.',
          'Parallel subagent exploration and full test suite verification permitted.',
          'Monitor rollout JSONL rate_limit_snapshot after each tool turn.',
        ],
      };
  }
}

/**
 * Optimizes a queue of Codex tasks against the current 5-hour and weekly usage limits.
 */
export function optimizeTaskQueue(
  tasks: CodexTaskItem[],
  snapshot: CodexRateLimitSnapshot,
  thresholds: PolicyThresholds = DEFAULT_THRESHOLDS
): TaskQueueOptimizationResult {
  for (const task of tasks) {
    if (![task.baseFiveHourCostPct, task.baseWeeklyCostPct].every(v => Number.isFinite(v) && v >= 0)) throw new Error('Task estimates must be finite and nonnegative');
  }
  const policy = evaluateQuotaPolicy(snapshot, thresholds);
  const isProExempt = false; // Plan labels do not exempt reported limits.

  let runningFiveHourPct = clampPct(snapshot.primary_window.used_percent);
  let runningWeeklyPct = clampPct(snapshot.secondary_window.used_percent);

  const maxAllowedPct = reserveCeiling(thresholds.reserveBufferPct);

  let totalBaseFiveHourPct = 0;
  let totalOptimizedFiveHourPct = 0;
  let totalBaseWeeklyPct = 0;
  let totalOptimizedWeeklyPct = 0;
  let tasksCompletedInWindow = 0;
  let tasksDeferred = 0;

  // Sort P0 first, then P1, then P2 while preserving relative order
  const priorityWeight: Record<CodexTaskItem['priority'], number> = {
    P0: 0,
    P1: 1,
    P2: 2,
  };
  const orderedTasks = [...tasks].sort(
    (a, b) => priorityWeight[a.priority] - priorityWeight[b.priority]
  );

  const items: OptimizedTaskPlanItem[] = orderedTasks.map((task) => {
    totalBaseFiveHourPct += task.baseFiveHourCostPct;
    totalBaseWeeklyPct += task.baseWeeklyCostPct;

    const remaining5h = isProExempt ? 100 : Math.max(0, maxAllowedPct - runningFiveHourPct);
    const remainingWeekly = Math.max(0, maxAllowedPct - runningWeeklyPct);

    // Choose execution mode based on policy + remaining budget + priority
    let executionMode: ExecutionMode = 'full-agentic';
    let assignedModel: RecommendedModel = policy.recommendedModel;
    let assignedReasoning: ReasoningEffort = policy.reasoningEffort;
    let multiplier = 1.0;
    let actionSummary = 'Full multi-turn agentic loop with complete test suite verification.';

    if (
      policy.constraintState === 'exhausted' ||
      remainingWeekly < task.baseWeeklyCostPct * 0.35 ||
      (!isProExempt && remaining5h < task.baseFiveHourCostPct * 0.35)
    ) {
      executionMode = 'defer-until-5h-reset';
      assignedModel = 'gpt-6-luna';
      assignedReasoning = 'low';
      multiplier = 0;
      actionSummary =
        remainingWeekly < task.baseWeeklyCostPct * 0.35
          ? 'Deferred: Insufficient weekly cap remaining; queued for post-reset checkpoint.'
          : 'Deferred: Would breach 5-hour burst window reserve; auto-scheduled for next 5h window.';
    } else if (
      policy.constraintState === '5h-critical' ||
      policy.constraintState === 'weekly-critical' ||
      task.priority === 'P2'
    ) {
      executionMode = 'mini-model-batch';
      assignedModel = 'gpt-6-luna';
      assignedReasoning = 'low';
      multiplier = 0.38;
      actionSummary =
        'Routed to gpt-6-luna with low reasoning effort and surgical line-range diffs (-62% quota).';
    } else if (
      policy.constraintState === '5h-warning' ||
      policy.constraintState === 'weekly-warning' ||
      remaining5h < task.baseFiveHourCostPct * 1.4
    ) {
      executionMode = 'compact-surgical';
      assignedModel = 'gpt-6.1-sol';
      assignedReasoning = 'medium';
      multiplier = 0.62;
      actionSummary =
        'Compacted context + medium reasoning + targeted module test execution (-38% quota).';
    } else {
      executionMode = 'full-agentic';
      assignedModel = 'gpt-6.1-sol';
      assignedReasoning = task.complexity === 'high' ? 'high' : 'medium';
      multiplier = 0.88;
      actionSummary =
        'Full gpt-6.1-sol reasoning with ripgrep-indexed context caching (-12% overhead).';
    }

    let optimizedFiveHourCostPct = clampPct(task.baseFiveHourCostPct * multiplier);
    let optimizedWeeklyCostPct = clampPct(task.baseWeeklyCostPct * multiplier);

    if (runningFiveHourPct >= maxAllowedPct || runningWeeklyPct >= maxAllowedPct || runningFiveHourPct + optimizedFiveHourCostPct > maxAllowedPct || runningWeeklyPct + optimizedWeeklyCostPct > maxAllowedPct) {
      executionMode = 'defer-until-5h-reset'; optimizedFiveHourCostPct = 0; optimizedWeeklyCostPct = 0;
      actionSummary = 'Deferred: selected execution cost exceeds a window reserve.';
    }
    const willFitCurrentWindow = executionMode !== 'defer-until-5h-reset';

    if (willFitCurrentWindow) {
      runningFiveHourPct = clampPct(runningFiveHourPct + optimizedFiveHourCostPct);
      runningWeeklyPct = clampPct(runningWeeklyPct + optimizedWeeklyCostPct);
      totalOptimizedFiveHourPct = clampPct(totalOptimizedFiveHourPct + optimizedFiveHourCostPct);
      totalOptimizedWeeklyPct = clampPct(totalOptimizedWeeklyPct + optimizedWeeklyCostPct);
      tasksCompletedInWindow += 1;
    } else {
      tasksDeferred += 1;
    }

    return {
      ...task,
      executionMode,
      assignedModel,
      assignedReasoning,
      optimizedFiveHourCostPct,
      optimizedWeeklyCostPct,
      cumulativeFiveHourPct: runningFiveHourPct,
      cumulativeWeeklyPct: runningWeeklyPct,
      actionSummary,
      willFitCurrentWindow,
    };
  });

  return {
    items,
    totalBaseFiveHourPct: clampPct(totalBaseFiveHourPct),
    totalOptimizedFiveHourPct: clampPct(totalOptimizedFiveHourPct),
    totalBaseWeeklyPct: clampPct(totalBaseWeeklyPct),
    totalOptimizedWeeklyPct: clampPct(totalOptimizedWeeklyPct),
    tasksCompletedInWindow,
    tasksDeferred,
    projectedFiveHourEndPct: runningFiveHourPct,
    projectedWeeklyEndPct: runningWeeklyPct,
  };
}

export function formatDurationSeconds(seconds: number): string {
  const safeSec = Math.max(0, Math.floor(seconds));
  const days = Math.floor(safeSec / 86400);
  const hours = Math.floor((safeSec % 86400) / 3600);
  const mins = Math.floor((safeSec % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${mins}m`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}
