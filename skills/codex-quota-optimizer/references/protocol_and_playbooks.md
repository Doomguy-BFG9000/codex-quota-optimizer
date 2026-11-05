# OpenAI Codex Rate-Limit Protocol & Low-Token Playbooks

This reference document is loaded on demand by `$codex-quota-optimizer` when Codex enters `WARNING_CONSERVE`, `CRITICAL_SURGICAL`, or `RESERVE_STOP` mode.

---

## 1. How `openai/codex` (`codex-rs`) Encodes Usage Limits

In the `openai/codex` Rust codebase (`codex-rs/protocol/src/protocol.rs`), local logs may contain a `RateLimitSnapshot` inside `EventMsg::TokenCount`:

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

- **`primary` (`window_minutes: 300`)**: The rolling **5-hour window**. Usage depends on the task, model, and account.
- **`secondary` (`window_minutes: 10080`)**: The rolling **7-day weekly window** (10,080 minutes). Treat reported usage and resets as observations, not a guarantee of future availability.

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
Cap verbose test output while preserving the underlying exit status:
```bash
# Fast typecheck (only show first 25 error lines):
npx tsc --noEmit 2>&1 | head -n 25

# Run only the single changed test file and show summary tail:
npx tsx --test src/module.test.ts 2>&1 | tail -n 25
```

Observations older than 15 minutes or past their reset are stale. Missing windows, timestamps, reset times, or unreadable logs remain unknown. Refresh telemetry before budgeted scheduling.
