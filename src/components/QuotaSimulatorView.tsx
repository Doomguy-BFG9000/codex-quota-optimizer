import React, { useState } from 'react';
import {
  Copy,
  Check,
  Play,
  RotateCcw,
  Sliders,
  Terminal,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import {
  type CodexRateLimitSnapshot,
  type PolicyThresholds,
  type WorkOptimizationPolicy,
  type CodexPlanTier,
  formatDurationSeconds,
  DEFAULT_THRESHOLDS,
} from '../engine/quotaEngine';

interface QuotaSimulatorViewProps {
  snapshot: CodexRateLimitSnapshot;
  onChangeSnapshot: (next: CodexRateLimitSnapshot) => void;
  thresholds: PolicyThresholds;
  onChangeThresholds: (next: PolicyThresholds) => void;
  policy: WorkOptimizationPolicy;
  onNavigateToSection: (section: 'simulator' | 'tasks' | 'repo' | 'audit') => void;
}

interface PresetScenario {
  id: string;
  label: string;
  description: string;
  plan: CodexPlanTier;
  fiveHourPct: number;
  fiveHourResetSec: number;
  weeklyPct: number;
  weeklyResetSec: number;
}

const PRESET_SCENARIOS: PresetScenario[] = [
  {
    id: 'nominal',
    label: 'Nominal Burst (28% / 34%)',
    description: 'Plenty of 5-hour and weekly headroom; full high-reasoning loop active.',
    plan: 'plus',
    fiveHourPct: 28,
    fiveHourResetSec: 12600,
    weeklyPct: 34,
    weeklyResetSec: 410400,
  },
  {
    id: '5h-warning',
    label: '5h Warning Zone (71% / 39%)',
    description: 'Heavy multi-file refactor accelerating 5-hour burn; steps down to medium reasoning.',
    plan: 'plus',
    fiveHourPct: 71,
    fiveHourResetSec: 7800,
    weeklyPct: 39,
    weeklyResetSec: 360000,
  },
  {
    id: '5h-crunch',
    label: '5h Window Crunch (88% / 46%)',
    description: 'Approaching 5-hour burst ceiling; routes to gpt-6-luna & surgical diffs.',
    plan: 'plus',
    fiveHourPct: 88,
    fiveHourResetSec: 4200,
    weeklyPct: 46,
    weeklyResetSec: 310000,
  },
  {
    id: 'weekly-critical',
    label: 'Weekly Cap Critical (42% / 91%)',
    description: '5-hour window is fresh, but 7-day weekly pool is nearly depleted.',
    plan: 'plus',
    fiveHourPct: 42,
    fiveHourResetSec: 14400,
    weeklyPct: 91,
    weeklyResetSec: 64800,
  },
  {
    id: 'pro-exempt',
    label: 'Pro Reported Limits (92% / 74%)',
    description: 'Reported limits apply to every plan, including Pro.',
    plan: 'pro',
    fiveHourPct: 92,
    fiveHourResetSec: 3600,
    weeklyPct: 74,
    weeklyResetSec: 216000,
  },
];

export const QuotaSimulatorView: React.FC<QuotaSimulatorViewProps> = ({
  snapshot,
  onChangeSnapshot,
  thresholds,
  onChangeThresholds,
  policy,
  onNavigateToSection,
}) => {
  const [copiedMcp, setCopiedMcp] = useState(false);
  const [activePresetId, setActivePresetId] = useState<string>('nominal');
  const [turnCounter, setTurnCounter] = useState<number>(1);

  const applyPreset = (preset: PresetScenario) => {
    setActivePresetId(preset.id);
    const nowMs = Date.now();
    onChangeSnapshot({
      ...snapshot,
      plan_type: preset.plan,
      primary_window: {
        window_minutes: 300,
        used_percent: preset.fiveHourPct,
        resets_in_seconds: preset.fiveHourResetSec,
        resets_at_iso: new Date(nowMs + preset.fiveHourResetSec * 1000).toISOString(),
      },
      secondary_window: {
        window_minutes: 10080,
        used_percent: preset.weeklyPct,
        resets_in_seconds: preset.weeklyResetSec,
        resets_at_iso: new Date(nowMs + preset.weeklyResetSec * 1000).toISOString(),
      },
      captured_at_iso: new Date(nowMs).toISOString(),
    });
  };

  const simulateNextTurn = () => {
    // Burn rate depends on active reasoning effort!
    const fiveHourDelta =
      policy.reasoningEffort === 'high'
        ? 8.5
        : policy.reasoningEffort === 'medium'
        ? 4.2
        : policy.reasoningEffort === 'low'
        ? 1.8
        : 0.4;
    const weeklyDelta = Number((fiveHourDelta * 0.22).toFixed(1));

    const nextFiveHour = Math.min(
      100,
      Number((snapshot.primary_window.used_percent + fiveHourDelta).toFixed(1))
    );
    const nextWeekly = Math.min(
      100,
      Number((snapshot.secondary_window.used_percent + weeklyDelta).toFixed(1))
    );

    setTurnCounter((c) => c + 1);
    setActivePresetId('custom');
    onChangeSnapshot({
      ...snapshot,
      primary_window: {
        ...snapshot.primary_window,
        used_percent: nextFiveHour,
        resets_in_seconds: Math.max(60, snapshot.primary_window.resets_in_seconds - 180),
      },
      secondary_window: {
        ...snapshot.secondary_window,
        used_percent: nextWeekly,
        resets_in_seconds: Math.max(300, snapshot.secondary_window.resets_in_seconds - 180),
      },
      captured_at_iso: new Date().toISOString(),
    });
  };

  const mcpToolPayload = JSON.stringify(
    {
      tool: 'get_codex_usage_limits',
      turn: turnCounter,
      rate_limit_snapshot: {
        plan_type: snapshot.plan_type,
        primary_window_5h: {
          window_minutes: snapshot.primary_window.window_minutes,
          used_percent: snapshot.primary_window.used_percent,
          remaining_effective_percent: policy.effectiveFiveHourRemainingPct,
          resets_in: formatDurationSeconds(snapshot.primary_window.resets_in_seconds),
          burn_velocity_ratio: policy.fiveHourBurnRatio,
        },
        secondary_window_weekly: {
          window_minutes: snapshot.secondary_window.window_minutes,
          used_percent: snapshot.secondary_window.used_percent,
          remaining_effective_percent: policy.effectiveWeeklyRemainingPct,
          resets_in: formatDurationSeconds(snapshot.secondary_window.resets_in_seconds),
          burn_velocity_ratio: policy.weeklyBurnRatio,
        },
      },
      adaptive_work_policy: {
        constraint_state: policy.constraintState,
        governing_window: policy.governingWindow,
        recommended_model: policy.recommendedModel,
        reasoning_effort: policy.reasoningEffort,
        max_context_tokens: policy.maxContextTokens,
        subagent_concurrency: policy.subagentConcurrency,
        test_verification_mode: policy.testVerificationMode,
        estimated_quota_savings_pct: policy.estimatedQuotaSavingsPct,
        agent_directives: policy.directives,
      },
    },
    null,
    2
  );

  const handleCopyMcp = () => {
    navigator.clipboard?.writeText(mcpToolPayload);
    setCopiedMcp(true);
    setTimeout(() => setCopiedMcp(false), 1800);
  };

  const renderStateSummaryText = () => {
    switch (policy.constraintState) {
      case 'exhausted':
        return {
          label: 'Reserve Ceiling Reached — Auto-Checkpoint Active',
          tone: 'text-red-700',
          icon: <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />,
        };
      case '5h-critical':
        return {
          label: '5-Hour Window Critical — Surgical Low-Reasoning Mode',
          tone: 'text-red-700',
          icon: <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />,
        };
      case 'weekly-critical':
        return {
          label: '7-Day Weekly Cap Critical — Mini-Model Conservation Mode',
          tone: 'text-red-700',
          icon: <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />,
        };
      case '5h-warning':
        return {
          label: '5-Hour Burst Elevated — Compact Medium-Reasoning Mode',
          tone: 'text-amber-700',
          icon: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />,
        };
      case 'weekly-warning':
        return {
          label: 'Weekly Pace Elevated — Targeted Verification Mode',
          tone: 'text-amber-700',
          icon: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />,
        };
      default:
        return {
          label: 'Nominal Headroom — Full Agentic High-Reasoning Mode',
          tone: 'text-emerald-700',
          icon: <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />,
        };
    }
  };

  const stateBanner = renderStateSummaryText();

  return (
    <div className="space-y-8">
      {/* Top Hero / Context Strip */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 pb-6 border-b border-slate-200">
          <div className="space-y-2 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>OpenAI Codex Protocol (codex-rs)</span>
              <span aria-hidden="true">·</span>
              <span>Dual-Window Telemetry Bridge</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">primary_window (300m) + secondary_window (10080m)</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900" style={{ textWrap: 'balance' }}>
              Give OpenAI Codex Tasks Real-Time 5-Hour & Weekly Quota Awareness
            </h1>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              By default, <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">openai/codex</code> writes{' '}
              <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">rate_limit_snapshot</code> events to{' '}
              <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">~/.codex/sessions/**/rollout-*.jsonl</code>{' '}
              for the TUI <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">/status</code> bar, but never exposes them to the agent loop.{' '}
              <strong>codex-quota-pilot</strong> exposes both limits via MCP so Codex dynamically throttles reasoning effort, model tier, and test scope before hitting HTTP 429.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={simulateNextTurn}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              Simulate Agent Turn #{turnCounter + 1}
            </button>
            <button
              type="button"
              onClick={() => onNavigateToSection('repo')}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Terminal className="w-3.5 h-3.5" />
              Inspect GitHub Repo Files
            </button>
          </div>
        </div>

        {/* Preset Scenario Segmented Bar */}
        <div className="pt-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <span className="text-xs font-semibold text-slate-700">
              Load Telemetry Scenario Preset
            </span>
            <span className="text-xs text-slate-500">
              Click a preset or drag the 5-hour and weekly sliders below to test policy transitions
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-100 rounded-lg">
            {PRESET_SCENARIOS.map((preset) => {
              const active = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={`px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Main 2-Column Split: Dual Window Controls (Left) + Computed Policy & Live MCP Output (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Column: Dual-Window Telemetry & Threshold Controls (7 cols) */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Dual-Window Quota Telemetry (<span className="font-mono text-base">RateLimitSnapshot</span>)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Source: <span className="font-mono">~/.codex/sessions/2026/11/04/rollout-8a9f.jsonl</span> · Plan Tier:{' '}
                  <span className="font-mono font-semibold text-slate-700">{snapshot.plan_type.toUpperCase()}</span>
                </p>
              </div>

              {/* Plan Tier Selector */}
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(['plus', 'pro', 'team', 'enterprise'] as CodexPlanTier[]).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => {
                      setActivePresetId('custom');
                      onChangeSnapshot({ ...snapshot, plan_type: tier });
                    }}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      snapshot.plan_type === tier
                        ? 'bg-white text-slate-900 shadow-xs font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tier.charAt(0).toUpperCase() + tier.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Window 1: 5-Hour Rolling Primary Window */}
            <div className="space-y-3 pb-6 border-b border-slate-200">
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <label
                    htmlFor="five-hour-slider"
                    className="text-sm font-semibold text-slate-900 block"
                  >
                    01. Primary Rolling Window (5-Hour Burst Limit)
                  </label>
                  <p className="text-xs text-slate-500 mt-0.5">
                    <span className="font-mono tabular-nums">window_minutes: 300</span> · Resets in{' '}
                    <span className="font-mono tabular-nums font-medium text-slate-700">
                      {formatDurationSeconds(snapshot.primary_window.resets_in_seconds)}
                    </span>{' '}
                    · Burn velocity:{' '}
                    <span className="font-mono tabular-nums font-medium text-slate-700">
                      {policy.fiveHourBurnRatio}x
                    </span>
                  </p>
                </div>
                <div className="text-right font-mono tabular-nums">
                  <span className="text-2xl font-bold text-slate-900">
                    {snapshot.primary_window.used_percent}%
                  </span>
                  <span className="text-xs text-slate-500 block">
                    {policy.effectiveFiveHourRemainingPct}% usable left
                  </span>
                </div>
              </div>

              {/* Progress Meter */}
              <div className="relative h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-transform duration-150 origin-left ${
                    snapshot.primary_window.used_percent >= thresholds.fiveHourCriticalPct
                      ? 'bg-red-600'
                      : snapshot.primary_window.used_percent >= thresholds.fiveHourWarningPct
                      ? 'bg-amber-500'
                      : 'bg-blue-600'
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(0, snapshot.primary_window.used_percent))}%`,
                  }}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div>
                  <div className="flex justify-between text-xs text-slate-600 mb-1">
                    <span>5-Hour Used (%)</span>
                    <span className="font-mono tabular-nums">{snapshot.primary_window.used_percent}%</span>
                  </div>
                  <input
                    id="five-hour-slider"
                    aria-label="5-Hour Rolling Window Used Percent"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={snapshot.primary_window.used_percent}
                    onChange={(e) => {
                      setActivePresetId('custom');
                      onChangeSnapshot({
                        ...snapshot,
                        primary_window: {
                          ...snapshot.primary_window,
                          used_percent: Number(e.target.value),
                        },
                      });
                    }}
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-600 mb-1">
                    <span>Time Until 5h Window Reset</span>
                    <span className="font-mono tabular-nums">
                      {formatDurationSeconds(snapshot.primary_window.resets_in_seconds)}
                    </span>
                  </div>
                  <input
                    id="five-hour-reset-slider"
                    aria-label="Time Until 5h Window Reset"
                    type="range"
                    min={300}
                    max={18000}
                    step={300}
                    value={snapshot.primary_window.resets_in_seconds}
                    onChange={(e) => {
                      setActivePresetId('custom');
                      onChangeSnapshot({
                        ...snapshot,
                        primary_window: {
                          ...snapshot.primary_window,
                          resets_in_seconds: Number(e.target.value),
                        },
                      });
                    }}
                    className="w-full accent-slate-700 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Window 2: 7-Day Weekly Secondary Window */}
            <div className="space-y-3 pb-6 border-b border-slate-200">
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <label
                    htmlFor="weekly-slider"
                    className="text-sm font-semibold text-slate-900 block"
                  >
                    02. Secondary Rolling Window (7-Day Weekly Cap)
                  </label>
                  <p className="text-xs text-slate-500 mt-0.5">
                    <span className="font-mono tabular-nums">window_minutes: 10080</span> · Resets in{' '}
                    <span className="font-mono tabular-nums font-medium text-slate-700">
                      {formatDurationSeconds(snapshot.secondary_window.resets_in_seconds)}
                    </span>{' '}
                    · Weekly pace:{' '}
                    <span className="font-mono tabular-nums font-medium text-slate-700">
                      {policy.weeklyBurnRatio}x
                    </span>
                  </p>
                </div>
                <div className="text-right font-mono tabular-nums">
                  <span className="text-2xl font-bold text-slate-900">
                    {snapshot.secondary_window.used_percent}%
                  </span>
                  <span className="text-xs text-slate-500 block">
                    {policy.effectiveWeeklyRemainingPct}% usable left
                  </span>
                </div>
              </div>

              {/* Progress Meter */}
              <div className="relative h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-transform duration-150 origin-left ${
                    snapshot.secondary_window.used_percent >= thresholds.weeklyCriticalPct
                      ? 'bg-red-600'
                      : snapshot.secondary_window.used_percent >= thresholds.weeklyWarningPct
                      ? 'bg-amber-500'
                      : 'bg-emerald-600'
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(0, snapshot.secondary_window.used_percent))}%`,
                  }}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div>
                  <div className="flex justify-between text-xs text-slate-600 mb-1">
                    <span>Weekly Used (%)</span>
                    <span className="font-mono tabular-nums">{snapshot.secondary_window.used_percent}%</span>
                  </div>
                  <input
                    id="weekly-slider"
                    aria-label="7-Day Weekly Window Used Percent"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={snapshot.secondary_window.used_percent}
                    onChange={(e) => {
                      setActivePresetId('custom');
                      onChangeSnapshot({
                        ...snapshot,
                        secondary_window: {
                          ...snapshot.secondary_window,
                          used_percent: Number(e.target.value),
                        },
                      });
                    }}
                    className="w-full accent-emerald-600 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-600 mb-1">
                    <span>Time Until Weekly Reset</span>
                    <span className="font-mono tabular-nums">
                      {formatDurationSeconds(snapshot.secondary_window.resets_in_seconds)}
                    </span>
                  </div>
                  <input
                    id="weekly-reset-slider"
                    aria-label="Time Until Weekly Window Reset"
                    type="range"
                    min={3600}
                    max={604800}
                    step={3600}
                    value={snapshot.secondary_window.resets_in_seconds}
                    onChange={(e) => {
                      setActivePresetId('custom');
                      onChangeSnapshot({
                        ...snapshot,
                        secondary_window: {
                          ...snapshot.secondary_window,
                          resets_in_seconds: Number(e.target.value),
                        },
                      });
                    }}
                    className="w-full accent-slate-700 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Policy Threshold Configuration */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-slate-600" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    03. Optimization Policy Thresholds (Synced to AGENTS.md & config.toml)
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => onChangeThresholds(DEFAULT_THRESHOLDS)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset Defaults
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label
                    htmlFor="thresh-5h-warn"
                    className="block text-xs text-slate-600 mb-1"
                  >
                    5h Warning (%)
                  </label>
                  <input
                    id="thresh-5h-warn"
                    type="number"
                    min={20}
                    max={90}
                    value={thresholds.fiveHourWarningPct}
                    onChange={(e) =>
                      onChangeThresholds({
                        ...thresholds,
                        fiveHourWarningPct: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="thresh-5h-crit"
                    className="block text-xs text-slate-600 mb-1"
                  >
                    5h Critical (%)
                  </label>
                  <input
                    id="thresh-5h-crit"
                    type="number"
                    min={40}
                    max={98}
                    value={thresholds.fiveHourCriticalPct}
                    onChange={(e) =>
                      onChangeThresholds({
                        ...thresholds,
                        fiveHourCriticalPct: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="thresh-wk-warn"
                    className="block text-xs text-slate-600 mb-1"
                  >
                    Weekly Warn (%)
                  </label>
                  <input
                    id="thresh-wk-warn"
                    type="number"
                    min={20}
                    max={90}
                    value={thresholds.weeklyWarningPct}
                    onChange={(e) =>
                      onChangeThresholds({
                        ...thresholds,
                        weeklyWarningPct: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="thresh-wk-crit"
                    className="block text-xs text-slate-600 mb-1"
                  >
                    Weekly Crit (%)
                  </label>
                  <input
                    id="thresh-wk-crit"
                    type="number"
                    min={40}
                    max={98}
                    value={thresholds.weeklyCriticalPct}
                    onChange={(e) =>
                      onChangeThresholds({
                        ...thresholds,
                        weeklyCriticalPct: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled
                    checked={false}
                    onChange={(e) =>
                      onChangeThresholds({
                        ...thresholds,
                        proExemptFiveHour: e.target.checked,
                      })
                    }
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>
                    Reported 5-hour and weekly limits apply to <strong>all plans</strong>
                  </span>
                </label>

                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <label htmlFor="reserve-buffer-input">Safety Reserve Buffer:</label>
                  <input
                    id="reserve-buffer-input"
                    type="number"
                    min={1}
                    max={20}
                    value={thresholds.reserveBufferPct}
                    onChange={(e) =>
                      onChangeThresholds({
                        ...thresholds,
                        reserveBufferPct: Number(e.target.value),
                      })
                    }
                    className="w-16 px-2 py-1 text-xs font-mono tabular-nums bg-slate-50 border border-slate-200 rounded"
                  />
                  <span>%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Active Work Optimization Policy + Live MCP Response (5 cols) */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-5">
            <div className="pb-4 border-b border-slate-200">
              <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                <span>Computed Task Execution Policy</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">Governing: {policy.governingWindow}</span>
              </div>
              <div className="flex items-center gap-2">
                {stateBanner.icon}
                <h2 className={`text-base font-bold ${stateBanner.tone}`}>
                  {stateBanner.label}
                </h2>
              </div>
            </div>

            {/* Key Decision Matrix */}
            <div className="grid grid-cols-2 gap-y-4 gap-x-6 py-2 border-b border-slate-200 text-sm">
              <div>
                <span className="text-xs text-slate-500 block">Target Model Routing</span>
                <span className="font-mono font-semibold text-slate-900">
                  {policy.recommendedModel}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Reasoning Effort</span>
                <span className="font-mono font-semibold text-slate-900">
                  reasoning_effort="{policy.reasoningEffort}"
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Context Window Cap</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {policy.maxContextTokens.toLocaleString()} tokens
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Subagent Concurrency</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {policy.subagentConcurrency} max workers
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Test Verification Strategy</span>
                <span className="font-mono font-semibold text-slate-900">
                  {policy.testVerificationMode}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Quota Burn Reduction</span>
                <span className="font-mono tabular-nums font-semibold text-emerald-700">
                  -{policy.estimatedQuotaSavingsPct}% per turn
                </span>
              </div>
            </div>

            {/* Concrete Directives injected into Codex task */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-700">
                Active Directives Returned to Codex Task
              </h3>
              <ul className="space-y-1.5 text-xs text-slate-600 list-disc pl-4">
                {policy.directives.map((directive, idx) => (
                  <li key={idx} className="leading-relaxed">
                    {directive}
                  </li>
                ))}
              </ul>
            </div>

            {/* Live MCP JSON Response Preview */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 font-mono">
                  MCP Tool Output: get_codex_usage_limits()
                </span>
                <button
                  type="button"
                  onClick={handleCopyMcp}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {copiedMcp ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      Copied JSON
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy Payload
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono tabular-nums overflow-x-auto max-h-60 leading-relaxed">
                {mcpToolPayload}
              </pre>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-4">
            <span className="text-xs text-slate-500">
              See how this policy schedules multi-step coding queues
            </span>
            <button
              type="button"
              onClick={() => onNavigateToSection('tasks')}
              className="px-3.5 py-2 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Open Task Queue Optimizer →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
