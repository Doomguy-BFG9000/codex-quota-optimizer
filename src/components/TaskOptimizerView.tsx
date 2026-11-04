import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  RotateCcw,
  Search,
  AlertCircle,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import {
  type CodexTaskItem,
  type CodexRateLimitSnapshot,
  type PolicyThresholds,
  type TaskQueueOptimizationResult,
  formatDurationSeconds,
} from '../engine/quotaEngine';

interface TaskOptimizerViewProps {
  tasks: CodexTaskItem[];
  onChangeTasks: (next: CodexTaskItem[]) => void;
  onResetDefaultTasks: () => void;
  snapshot: CodexRateLimitSnapshot;
  thresholds: PolicyThresholds;
  optimizationResult: TaskQueueOptimizationResult;
}

export const TaskOptimizerView: React.FC<TaskOptimizerViewProps> = ({
  tasks,
  onChangeTasks,
  onResetDefaultTasks,
  snapshot,
  thresholds,
  optimizationResult,
}) => {
  const [titleInput, setTitleInput] = useState('');
  const [categoryInput, setCategoryInput] = useState<CodexTaskItem['category']>('feature');
  const [priorityInput, setPriorityInput] = useState<CodexTaskItem['priority']>('P0');
  const [complexityInput, setComplexityInput] = useState<CodexTaskItem['complexity']>('medium');
  const [filesInput, setFilesInput] = useState<number>(4);
  const [fiveHourCostInput, setFiveHourCostInput] = useState<number>(14);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [priorityFilter, setPriorityFilter] = useState<'ALL' | 'P0' | 'P1' | 'P2'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = titleInput.trim();
    if (!trimmed) {
      setValidationError('Please enter a non-empty task description before queuing.');
      return;
    }
    if (fiveHourCostInput <= 0 || fiveHourCostInput > 100) {
      setValidationError('Estimated 5-hour window cost must be between 1% and 100%.');
      return;
    }

    setValidationError(null);
    const weeklyEstimate = Number((fiveHourCostInput * 0.24).toFixed(1));
    const newTask: CodexTaskItem = {
      id: `task-${Date.now()}`,
      title: trimmed,
      category: categoryInput,
      priority: priorityInput,
      complexity: complexityInput,
      filesTouched: Math.max(1, filesInput),
      baseFiveHourCostPct: fiveHourCostInput,
      baseWeeklyCostPct: weeklyEstimate,
    };

    onChangeTasks([...tasks, newTask]);
    setTitleInput('');
  };

  const handleDeleteTask = (id: string) => {
    onChangeTasks(tasks.filter((t) => t.id !== id));
  };

  const filteredItems = optimizationResult.items.filter((item) => {
    const matchesPriority = priorityFilter === 'ALL' || item.priority === priorityFilter;
    const matchesQuery =
      !searchQuery.trim() ||
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.assignedModel.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesPriority && matchesQuery;
  });

  const unoptimizedWouldOverflow5h =
    snapshot.primary_window.used_percent + optimizationResult.totalBaseFiveHourPct >
    100 - thresholds.reserveBufferPct;

  return (
    <div className="space-y-8">
      {/* Quantitative Comparison Header */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-6 border-b border-slate-200">
          <div className="space-y-1.5 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>MCP Tool: optimize_codex_task_plan</span>
              <span aria-hidden="true">·</span>
              <span>Starting 5h Window: {snapshot.primary_window.used_percent}%</span>
              <span aria-hidden="true">·</span>
              <span>Starting Weekly Cap: {snapshot.secondary_window.used_percent}%</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              Quota-Aware Task Queue Scheduler
            </h1>
            <p className="text-sm text-slate-600">
              Schedules pending Codex subtasks across your remaining 5-hour rolling window (resets in{' '}
              <span className="font-mono tabular-nums font-medium text-slate-800">
                {formatDurationSeconds(snapshot.primary_window.resets_in_seconds)}
              </span>
              ) and 7-day weekly cap. Automatically compacts context, routes P1/P2 tasks to{' '}
              <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                codex-mini-latest
              </code>
              , or defers non-critical work before hitting HTTP 429.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onResetDefaultTasks}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restore Sample Queue
            </button>
            {tasks.length > 0 && (
              <button
                type="button"
                onClick={() => onChangeTasks([])}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear Queue
              </button>
            )}
          </div>
        </div>

        {/* 4-Column Quantitative Proof Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="space-y-1">
            <span className="text-xs text-slate-500 block">
              Unoptimized Queue 5h Burn
            </span>
            <div className="font-mono tabular-nums text-2xl font-bold text-slate-900">
              +{optimizationResult.totalBaseFiveHourPct}%
            </div>
            <p className="text-xs text-slate-600">
              {unoptimizedWouldOverflow5h ? (
                <span className="text-red-700 font-medium">
                  Would hit HTTP 429 mid-queue ({snapshot.primary_window.used_percent + optimizationResult.totalBaseFiveHourPct}% total)
                </span>
              ) : (
                <span>Fits within current 5-hour window</span>
              )}
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-xs text-slate-500 block">
              Quota-Pilot Optimized 5h Burn
            </span>
            <div className="font-mono tabular-nums text-2xl font-bold text-blue-600">
              +{optimizationResult.totalOptimizedFiveHourPct}%
            </div>
            <p className="text-xs text-slate-600">
              Projected 5h window end:{' '}
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                {optimizationResult.projectedFiveHourEndPct}%
              </span>{' '}
              (Reserve: {thresholds.reserveBufferPct}%)
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-xs text-slate-500 block">
              Weekly Pool Impact (Optimized vs Base)
            </span>
            <div className="font-mono tabular-nums text-2xl font-bold text-emerald-700">
              +{optimizationResult.totalOptimizedWeeklyPct}%{' '}
              <span className="text-sm font-normal text-slate-400 line-through">
                +{optimizationResult.totalBaseWeeklyPct}%
              </span>
            </div>
            <p className="text-xs text-slate-600">
              Projected weekly end:{' '}
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                {optimizationResult.projectedWeeklyEndPct}%
              </span>
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-xs text-slate-500 block">
              Active Window Execution Split
            </span>
            <div className="font-mono tabular-nums text-2xl font-bold text-slate-900">
              {optimizationResult.tasksCompletedInWindow} Run / {optimizationResult.tasksDeferred} Deferred
            </div>
            <p className="text-xs text-slate-600">
              Zero dirty-tree lockouts across {optimizationResult.items.length} queued tasks
            </p>
          </div>
        </div>
      </section>

      {/* Add Task Form */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-base font-bold text-slate-900 mb-4">
          Add Subtask to Codex Execution Plan
        </h2>
        <form onSubmit={handleAddTask} noValidate className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
            <div className="lg:col-span-5">
              <label htmlFor="task-title-input" className="block text-xs font-medium text-slate-700 mb-1">
                Task Description
              </label>
              <input
                id="task-title-input"
                type="text"
                placeholder="e.g., Refactor MCP stdio JSON-RPC stream handler"
                value={titleInput}
                onChange={(e) => {
                  setTitleInput(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>

            <div className="lg:col-span-2">
              <label htmlFor="task-priority-select" className="block text-xs font-medium text-slate-700 mb-1">
                Priority
              </label>
              <select
                id="task-priority-select"
                value={priorityInput}
                onChange={(e) => setPriorityInput(e.target.value as CodexTaskItem['priority'])}
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"
              >
                <option value="P0">P0 (Blocker)</option>
                <option value="P1">P1 (Standard)</option>
                <option value="P2">P2 (Nice-to-have)</option>
              </select>
            </div>

            <div className="lg:col-span-2">
              <label htmlFor="task-complexity-select" className="block text-xs font-medium text-slate-700 mb-1">
                Complexity
              </label>
              <select
                id="task-complexity-select"
                value={complexityInput}
                onChange={(e) => setComplexityInput(e.target.value as CodexTaskItem['complexity'])}
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div className="lg:col-span-1">
              <label htmlFor="task-5h-cost-input" className="block text-xs font-medium text-slate-700 mb-1">
                Est. 5h %
              </label>
              <input
                id="task-5h-cost-input"
                type="number"
                min={1}
                max={60}
                value={fiveHourCostInput}
                onChange={(e) => setFiveHourCostInput(Number(e.target.value))}
                className="w-full px-2.5 py-2 text-sm font-mono tabular-nums bg-slate-50 border border-slate-200 rounded-lg"
              />
            </div>

            <div className="lg:col-span-2">
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Queue Task
              </button>
            </div>
          </div>

          {validationError && (
            <div
              role="alert"
              className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}
        </form>
      </section>

      {/* Task Schedule Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 sm:px-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['ALL', 'P0', 'P1', 'P2'] as const).map((prio) => (
              <button
                key={prio}
                type="button"
                onClick={() => setPriorityFilter(prio)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  priorityFilter === prio
                    ? 'bg-white text-slate-900 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {prio === 'ALL' ? 'All Priorities' : `${prio} Only`}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              aria-label="Filter tasks by keyword or model"
              placeholder="Filter tasks or assigned model..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <p className="text-sm font-semibold text-slate-800">
              No tasks in the execution plan match the current view.
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Add a coding subtask using the form above or restore the default OpenAI Codex engineering task queue to preview quota-aware routing.
            </p>
            <button
              type="button"
              onClick={() => {
                setPriorityFilter('ALL');
                setSearchQuery('');
                if (tasks.length === 0) onResetDefaultTasks();
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restore Default Task Queue
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Priority & Task</th>
                  <th className="py-3 px-4">Assigned Model & Effort</th>
                  <th className="py-3 px-4">Optimization Strategy</th>
                  <th className="py-3 px-4 text-right">5h Burn (Opt / Base)</th>
                  <th className="py-3 px-4 text-right">Cumulative 5h / Wk</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 align-top">
                      <div className="font-medium text-slate-900">{item.title}</div>
                      <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono font-semibold text-slate-700">
                          {item.priority}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{item.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.filesTouched} files</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.complexity} complexity</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 align-top font-mono text-xs">
                      <div className="font-semibold text-slate-900">{item.assignedModel}</div>
                      <div className="text-slate-500 mt-0.5">
                        reasoning="{item.assignedReasoning}"
                      </div>
                    </td>

                    <td className="py-3.5 px-4 align-top max-w-xs">
                      <div className="flex items-center gap-1.5 text-xs font-semibold">
                        {item.willFitCurrentWindow ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        )}
                        <span
                          className={
                            item.willFitCurrentWindow ? 'text-slate-900' : 'text-amber-700'
                          }
                        >
                          {item.executionMode}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                        {item.actionSummary}
                      </p>
                    </td>

                    <td className="py-3.5 px-4 align-top text-right font-mono tabular-nums text-xs">
                      <span className="font-semibold text-slate-900">
                        +{item.optimizedFiveHourCostPct}%
                      </span>{' '}
                      <span className="text-slate-400 line-through">
                        +{item.baseFiveHourCostPct}%
                      </span>
                      <div className="text-slate-500 mt-0.5">
                        Wk: +{item.optimizedWeeklyCostPct}%
                      </div>
                    </td>

                    <td className="py-3.5 px-4 align-top text-right font-mono tabular-nums text-xs">
                      <div className="font-semibold text-slate-900">
                        5h: {item.cumulativeFiveHourPct}%
                      </div>
                      <div className="text-slate-500 mt-0.5">
                        Wk: {item.cumulativeWeeklyPct}%
                      </div>
                    </td>

                    <td className="py-3.5 px-4 align-top text-right">
                      <button
                        type="button"
                        aria-label={`Remove task ${item.title}`}
                        onClick={() => handleDeleteTask(item.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
