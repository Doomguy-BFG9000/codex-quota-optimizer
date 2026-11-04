import React, { useState } from 'react';
import { Play, AlertCircle, CheckCircle2, FileJson } from 'lucide-react';
import { type CodexRateLimitSnapshot } from '../engine/quotaEngine';

interface FrameworkAuditViewProps {
  onImportSnapshot: (next: CodexRateLimitSnapshot) => void;
  onNavigateToSimulator: () => void;
}

const SAMPLE_ROLLOUT_JSONL = `{"timestamp":"2026-11-04T14:22:19.401Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":84210,"cached_input_tokens":62100,"output_tokens":4190,"reasoning_output_tokens":2840,"total_tokens":88400}},"rate_limits":{"plan_type":"plus","primary":{"used_percent":82.5,"window_minutes":300,"resets_in_seconds":5400},"secondary":{"used_percent":64.0,"window_minutes":10080,"resets_in_seconds":259200}}}}`;

export const FrameworkAuditView: React.FC<FrameworkAuditViewProps> = ({
  onImportSnapshot,
  onNavigateToSimulator,
}) => {
  const [jsonlInput, setJsonlInput] = useState(SAMPLE_ROLLOUT_JSONL);
  const [parseStatus, setParseStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const handleParseRolloutLine = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = jsonlInput.trim();
    if (!raw) {
      setParseStatus({
        ok: false,
        message: 'Please paste a non-empty JSONL event line from ~/.codex/sessions/**/rollout-*.jsonl.',
      });
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      const rateLimits =
        parsed?.payload?.rate_limits ||
        parsed?.rate_limits ||
        parsed?.msg?.rate_limits;

      const primary = rateLimits?.primary || rateLimits?.primary_window;
      const secondary = rateLimits?.secondary || rateLimits?.secondary_window;

      if (!primary || typeof primary.used_percent !== 'number') {
        setParseStatus({
          ok: false,
          message:
            'JSON parsed, but no payload.rate_limits.primary.used_percent field was found.',
        });
        return;
      }

      const nowMs = Date.now();
      const pResetSec = Number(primary.resets_in_seconds ?? 7200);
      const sResetSec = Number(secondary?.resets_in_seconds ?? 302400);

      const imported: CodexRateLimitSnapshot = {
        plan_type: rateLimits.plan_type || 'plus',
        primary_window: {
          window_minutes: Number(primary.window_minutes ?? 300),
          used_percent: Number(primary.used_percent),
          resets_in_seconds: pResetSec,
          resets_at_iso: new Date(nowMs + pResetSec * 1000).toISOString(),
        },
        secondary_window: {
          window_minutes: Number(secondary?.window_minutes ?? 10080),
          used_percent: Number(secondary?.used_percent ?? 0),
          resets_in_seconds: sResetSec,
          resets_at_iso: new Date(nowMs + sResetSec * 1000).toISOString(),
        },
        source: 'rollout_jsonl',
        captured_at_iso: new Date(nowMs).toISOString(),
      };

      onImportSnapshot(imported);
      setParseStatus({
        ok: true,
        message: `Parsed rollout snapshot: 5-hour window at ${imported.primary_window.used_percent}% (300m) and weekly window at ${imported.secondary_window.used_percent}% (10080m). Loaded into Simulator!`,
      });
    } catch {
      setParseStatus({
        ok: false,
        message: 'Invalid JSON syntax. Paste a single JSONL line from a Codex session rollout file.',
      });
    }
  };

  return (
    <div className="space-y-8">
      {/* Architecture Breakdown */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div className="space-y-2 pb-5 border-b border-slate-200">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>OpenAI Codex Framework Audit</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">github.com/openai/codex (codex-rs)</span>
            <span aria-hidden="true">·</span>
            <span>Protocol & Session Rollout Analysis</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            Why OpenAI Codex Tasks Cannot See Their Own Usage Limits—And How We Fix It
          </h1>
          <p className="text-sm text-slate-600 max-w-3xl leading-relaxed">
            An audit of the <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">openai/codex</code> Rust workspace (<code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">codex-rs/protocol</code>, <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">codex-rs/core</code>, and <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">codex-rs/tui</code>) reveals that the CLI already receives exact 5-hour and weekly rate-limit snapshots on every response—it simply drops them before constructing the model's tool context.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-2 pb-4 lg:pb-0 lg:pr-6 lg:border-r border-slate-200">
            <h2 className="text-base font-bold text-slate-900">
              01. Protocol Struct (<span className="font-mono text-sm">RateLimitSnapshot</span>)
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              In <code className="font-mono text-slate-800">codex-rs/protocol/src/protocol.rs</code>, OpenAI defines <code className="font-mono text-slate-800">RateLimitSnapshot</code> with two <code className="font-mono text-slate-800">RateLimitWindow</code> fields:
            </p>
            <ul className="text-xs text-slate-600 space-y-1.5 list-disc pl-4">
              <li>
                <span className="font-mono font-semibold text-slate-800">primary</span>: <span className="font-mono tabular-nums">window_minutes = 300</span> (5-hour rolling burst allowance), <span className="font-mono">used_percent</span>, and <span className="font-mono">resets_in_seconds</span>.
              </li>
              <li>
                <span className="font-mono font-semibold text-slate-800">secondary</span>: <span className="font-mono tabular-nums">window_minutes = 10080</span> (7-day weekly cap), <span className="font-mono">used_percent</span>, and <span className="font-mono">resets_in_seconds</span>.
              </li>
            </ul>
          </div>

          <div className="space-y-2 pb-4 lg:pb-0 lg:pr-6 lg:border-r border-slate-200">
            <h2 className="text-base font-bold text-slate-900">
              02. Where Telemetry Is Persisted Locally
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Whenever the Codex backend (<code className="font-mono text-slate-800">chatgpt.com/backend-api/codex</code>) responds, <code className="font-mono text-slate-800">codex-core</code> emits an <code className="font-mono text-slate-800">EventMsg::TokenCount</code> containing <code className="font-mono text-slate-800">rate_limits</code>.
            </p>
            <ul className="text-xs text-slate-600 space-y-1.5 list-disc pl-4">
              <li>
                Written to disk at <span className="font-mono text-slate-800">~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl</span>.
              </li>
              <li>
                Rendered only when a human types <span className="font-mono text-slate-800">/status</span> in the TUI—never injected into the agent's prompt or native tools.
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <h2 className="text-base font-bold text-slate-900">
              03. How <span className="font-mono text-sm">codex-quota-pilot</span> Closes the Loop
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Without modifying the compiled <code className="font-mono text-slate-800">codex</code> binary, our repository registers an MCP server in <code className="font-mono text-slate-800">~/.codex/config.toml</code> and rules in <code className="font-mono text-slate-800">~/.codex/AGENTS.md</code>:
            </p>
            <ul className="text-xs text-slate-600 space-y-1.5 list-disc pl-4">
              <li>
                Tails the active <span className="font-mono text-slate-800">rollout-*.jsonl</span> and <span className="font-mono text-slate-800">/backend-api/wham/usage</span>.
              </li>
              <li>
                Computes an actionable policy (<span className="font-mono text-slate-800">reasoning_effort</span>, model tier, test scope) so tasks finish cleanly within remaining quota.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Interactive Rollout JSONL Parser */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FileJson className="w-4 h-4 text-blue-600" />
              <h2 className="text-base font-bold text-slate-900">
                Live <span className="font-mono text-sm">~/.codex/sessions/**/rollout-*.jsonl</span> Event Parser
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Paste a raw JSONL line from your local Codex session log (or test the real sample payload below) to parse its 5-hour and weekly windows into the simulator.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setJsonlInput(SAMPLE_ROLLOUT_JSONL);
              setParseStatus(null);
            }}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Load Sample Rollout JSONL Line
          </button>
        </div>

        <form onSubmit={handleParseRolloutLine} className="space-y-3">
          <label htmlFor="rollout-jsonl-textarea" className="sr-only">
            Rollout JSONL Event Payload
          </label>
          <textarea
            id="rollout-jsonl-textarea"
            rows={4}
            value={jsonlInput}
            onChange={(e) => setJsonlInput(e.target.value)}
            className="w-full p-3.5 text-xs font-mono tabular-nums bg-slate-950 text-slate-100 rounded-lg border border-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              Parse Rollout Event & Apply to Simulator
            </button>

            {parseStatus?.ok && (
              <button
                type="button"
                onClick={onNavigateToSimulator}
                className="px-3.5 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer"
              >
                View Imported Snapshot in Simulator →
              </button>
            )}
          </div>

          {parseStatus && (
            <div
              role="status"
              className={`flex items-center gap-2 text-xs px-3.5 py-2.5 rounded-lg border ${
                parseStatus.ok
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-red-50 text-red-700 border-red-200'
              }`}
            >
              {parseStatus.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              )}
              <span>{parseStatus.message}</span>
            </div>
          )}
        </form>
      </section>
    </div>
  );
};
