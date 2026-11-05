# Benchmark protocol: does the skill reduce quota consumption?

**Current status: no controlled real-world savings result has been established by this repository.** Automated tests demonstrate parsing and scheduling behavior. The demonstration uses synthetic inputs. This protocol is a way to collect evidence, not a claim that savings exist.

## Question and comparison

For equivalent completed tasks, does using this skill change observed quota consumption, completion time, or result quality compared with the same workflow without the skill?

Compare a baseline without skill instructions/MCP with a treatment using the skill. Use a clean checkout of the same task's starting commit, the same prompt and acceptance tests, the same Codex client version, account plan, model, reasoning effort, tools, and approval settings in both arms. Keep the model fixed to isolate workflow effects. If testing different models as a separate experiment, report that explicitly and check quality equivalence.

For the baseline, avoid this repository's AGENTS.md and installed global instructions accidentally activating the skill. Record the configuration differences. Never remove a user's global configuration automatically; use an isolated, explicitly configured test environment.

## Run procedure

1. Choose several small, public tasks with objective acceptance tests before running either arm. Record task IDs, prompts, starting commits, and the expected result.
2. Confirm fresh observations for **both** quota windows immediately before each run. Record timestamps, usage percentages and reset times. If telemetry is missing/stale, mark the quota result unavailable; token metrics may still be reported separately.
3. Avoid other activity on the same account while measuring. Do not compare across window resets or known account/limit changes. Alternate or randomize which arm runs first to reduce order effects.
4. Run each task from the same starting state in a fresh session. Record actual model/effort, tool actions, elapsed time, completion/defer status, and resulting commit. Record instruction setup overhead separately.
5. Record fresh observations immediately after each run. If updates are delayed, document how long you waited and any intervening activity. Do not run extra tasks just to force an update. Mark reset crossings or contaminated observations invalid.
6. Run the same acceptance checks in both arms and assess the results using the same criteria. Repeat matched pairs when your allowance permits; report the number of valid pairs, spread, failures, and missing measurements. One favorable run is not a general result.

This guide does not start model runs. Real runs consume the tester's allowance; choose a budget before starting.

## What to record

Use the [blank result template](BENCHMARK_RESULT_TEMPLATE.md) for each paired task. Include project commit, Codex/Node/OS versions, task/prompt, model and effort, active instructions, timestamps, both before/after quota readings, token metrics if available, elapsed time, quality checks, completion status, and confounders. Do not include credentials or raw private rollout logs.

## Calculation and interpretation

For each usable window, compute **usage delta in percentage points = after usage - before usage**. Report this directly for baseline and treatment. A negative delta, reset crossing, inconsistent snapshot, or concurrent activity is not a valid savings result.

Only for valid, equivalent completed pairs with a positive baseline delta may you calculate a relative difference:

```text
relative reduction (%) = 100 * (baseline delta - treatment delta) / baseline delta
```

Allow negative results: a treatment that consumes more should be reported. Keep 5h and weekly metrics separate. Small deltas can be dominated by rounding, delayed updates, and window behavior; zero observed change does not establish zero consumption. Do not average invalid pairs or combine account plans into a universal percentage.

A deferred task is a defer result, not a zero-cost completed task. Token counts are a separate metric and are not a documented conversion to subscription allowance. Record installation/setup overhead and any lost quality or increased latency. Do not use the scheduler's .88/.62/.38 cost multipliers as measured values.

## Publish or submit a result

Open an issue with the measurement template or submit a PR containing a sanitized result under `docs/benchmarks/`. Include raw **numeric observations**, the task source and acceptance checks, method, invalid runs, limitations, and a clearly scoped conclusion. Favor a reproducible negative or inconclusive result over an unsupported savings claim. Maintainers should review measurements before summarizing them in the README.
