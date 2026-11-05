# Contributing

Thanks for helping make Codex quota observations and planning more reliable. Bug reports, documentation, synthetic parser fixtures, and reproducible measurements are welcome. Negative or inconclusive benchmark results are useful too.

## Start small

1. Search existing [issues](https://github.com/Thlookingatyou/codex-quota-optimizer/issues) for duplicates.
2. Pick an issue labeled `good first issue`, or describe the problem and proposed scope in a new issue. Comment before starting a substantial change so maintainers can discuss compatibility.
3. Keep each pull request focused. Use a separate branch or fork; include the reason for the change and how you verified it.

For a first contribution, improving a troubleshooting example or adding a synthetic parser fixture is a good starting point. Avoid unrelated refactors. New dependencies, changes to freshness/reserve rules, network access, or credential handling need design discussion before implementation.

## Set up

Node.js 22.12 or later and Git are required. CI currently runs Node 24 on Linux and Windows.

```sh
git clone https://github.com/Thlookingatyou/codex-quota-optimizer.git
cd codex-quota-optimizer
npm ci
npm run demo
```

You do not need an API key, Codex account, or active quota observations to run the demo or test suite. Do not run `install.sh` merely to develop or test; it changes your global Codex configuration.

## Verify changes

```sh
npm run lint
npm test
npm run build
```

The dependency-free regression suite can also run directly:

```sh
node --test tests/regressions.test.mjs
```

Use `npm run demo:preview` after editing the demo to regenerate `docs/assets/demo.svg` and confirm that the plain-text example in `docs/DEMO.md` matches. The demo executes five assertions against actual parser/report/scheduler functions, using synthetic observations and a fixed clock. It is not a quota savings benchmark.

`skills/codex-quota-optimizer` is the canonical skill directory. After changing any of its files, run `npm run sync:skill`; regression tests check that `.agents/skills/codex-quota-optimizer` matches byte for byte. Use `npm pack --dry-run` when changing package contents.

## Report a bug safely

Use the bug template and include the exact command, OS, Node and Codex versions, expected behavior, and actual result. If relevant, paste only a minimal **redacted** event containing the timestamp and `rate_limits`. Remove prompts, repository paths, account identifiers, unrelated payloads, and secrets. Never upload `auth.json`, tokens, or an entire rollout log.

Missing telemetry is a supported state. Report whether the issue is unexpected missing data, stale data, a parsing error, or a misleading recommendation. A report does not need a proposed fix.

## Measurements and claims

Follow [the benchmark protocol](docs/BENCHMARK.md). Keep measured observations separate from projected estimates. A task that was deferred or completed with lower quality is not a like-for-like savings result. Do not present fixture output, token counts, or scheduler multipliers as measured subscription quota savings.

## Pull-request checklist

- Explain the problem and resulting behavior; link an issue when relevant.
- Include meaningful regression coverage for behavior changes and synthetic inputs for parser changes.
- Record which checks passed and any checks you could not run.
- Keep both skill copies synchronized when applicable.
- Avoid private logs, credentials, and unsupported performance claims.

Maintainers may request changes, ask for a smaller scope, or defer features that do not fit the offline tool. There is no promised review time. By contributing, you agree that your contribution is distributed under this repository's MIT license.
