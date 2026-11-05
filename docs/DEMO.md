# Reproducible behavior demo

From the repository root, run `node scripts/demo.mjs` (or `npm run demo`). No dependency installation, account, API key, or global skill installation is required.

The command calls the real parser, report builder, and scheduler with synthetic events and a fixed clock. It makes no model or network calls, reads no local sessions, and checks five expected behaviors with assertions. A failed assertion exits with a nonzero status. Environment quota thresholds are overridden for this demonstration so that the output is repeatable.

```text
codex-quota-optimizer | reproducible behavior demo
Synthetic inputs. No Codex calls, local sessions, or credentials.

Fresh observation
  5h 32% | weekly 41% | NOMINAL
  EXECUTE_FULL | projected 5h 40.8%

Too close to reserve
  5h 91.4% | weekly 58% | CRITICAL_SURGICAL
  DEFER_UNTIL_RESET | projected 5h 91.4%

Missing telemetry
  5h unknown | weekly unknown | TELEMETRY_UNKNOWN
  DEFER_UNTIL_RESET | projected 5h unknown

Stale observation
  5h unknown | weekly unknown | TELEMETRY_UNKNOWN
  DEFER_UNTIL_RESET | projected 5h unknown

Reserve reached
  5h 95% | weekly 58% | RESERVE_STOP
  DEFER_UNTIL_RESET | projected 5h 95%

PASS: all 5 behavior checks. Actual quota savings: not measured.
```

The task has a 10-point 5h estimate and 2-point weekly estimate. At 91.4%, a minimal execution multiplier of .38 would produce a projected 95.2%, so it defers. Missing and stale data produce unknown values rather than fabricated headroom. Starting at the reserve ceiling also defers new work.

This demonstrates software behavior, not a comparison of real Codex consumption. See [the benchmark protocol](BENCHMARK.md) to contribute measurements. The README image is generated from exactly this transcript using `npm run demo:preview`; it is a terminal-style rendering, not an account screenshot.
