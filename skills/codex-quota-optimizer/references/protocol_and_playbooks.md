# OpenAI Codex Rate-Limit Protocol & Low-Token Playbooks

This reference document is loaded on demand by `$codex-quota-optimizer` when Codex enters `WARNING_CONSERVE`, `CRITICAL_SURGICAL`, or `RESERVE_STOP` mode.

---

## 1. How `openai/codex` (`codex-rs`) Encodes Usage Limits

In the `openai/codex` Rust codebase (`codex-rs/protocol/src/protocol.rs`), the backend returns a `RateLimitSnapshot` on every turn inside `EventMsg::TokenCount`:

```json
{
  "timestamp": "2026-11-04T14:22:19.401Z",
  "type": "event_msg",
  "payload": {
    "type": "token_count",
    "rate_limits": {
      "plan_type": "plus",
      "primary": {
        "used_percent": 78.5,
        "window_minutes": 300,
        "resets_in_seconds": 5400
      },
      "secondary": {
        "used_percent": 62.0,
        "window_minutes": 10080,
        "resets_in_seconds": 259200
      }
    }
  }
}
```

- **`primary` (`window_minutes: 300`)**: The rolling **5-hour window**. Heavy multi-turn agentic loops with full-file reads and un-truncated test stdout can consume 15%–25% of this window in a single task.
- **`secondary` (`window_minutes: 10080`)**: The rolling **7-day weekly window** (10,080 minutes). Even when the 5-hour window resets to `0%`, if `secondary.used_percent` hits `100%`, all Codex tasks fail with `HTTP 429 Too Many Requests` until the weekly reset timestamp.

---

## 2. Shell Playbooks for Low-Token Code Navigation (`WARNING` & `CRITICAL` Modes)

When `check_quota.mjs` reports `WARNING_CONSERVE` or `CRITICAL_SURGICAL`, replace expensive whole-file reads and verbose test runs with these low-token shell patterns:

### A. Surgical Symbol & Line Discovery (Instead of `cat` or Full File Reads)
```bash
# 1. Find exact line numbers of function/class definitions first:
rg -n "(export |function |class |interface )" src/

# 2. Read ONLY the 40-line window around the target line (e.g., lines 80..120):
sed -n '80,120p' src/targetFile.ts
```

### B. Low-Token Diff & Git State Inspection
```bash
# Check modified lines concisely without dumping 500 lines of context:
git diff --stat
git diff -U1 src/targetFile.ts
```

### C. Truncated Test & Typecheck Execution
Verbose test runner output (stack traces, passing test lists, webpack/vite bundle logs) is the #1 cause of 5-hour quota exhaustion in multi-turn loops. Always cap stdout:
```bash
# Fast typecheck (only show first 25 error lines):
npx tsc --noEmit 2>&1 | head -n 25

# Run only the single changed test file and show summary tail:
npx tsx --test src/module.test.ts 2>&1 | tail -n 25
```
