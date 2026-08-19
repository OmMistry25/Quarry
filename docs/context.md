# Quarry — Context

Background for anyone (human or agent) joining this project cold.

## Who's building this & why

Om — GTM engineer at an ITSM AI startup, strong builder background (growth eng, ML, multiple side projects). This is a **side-project validation sprint**, not a company: the goal is to prove the concept works and show it to ~5 people who hire engineers. Time budget: a weekend to a week of Claude Code-driven building.

## Origin

Started from a real need: "is there a tool that connects to my PostHog/GitHub, inspects docs+code, and creates take-home test cases for candidates?" Market scan (Aug 2026) found take-home *platforms* (CodeSubmit, Coderbyte, HackerRank, Vervoe, etc. — question banks, not repo ingestion) and repo-aware *agents* (Claude Code, Cursor, GitLoop — not hiring products), but nothing that generates assessments *from your codebase*. Quarry fills that gap.

## Decision log (settled — don't reopen without a reason)

1. **Synthesize, don't extract.** Generated candidate repos mirror the source repo's stack/patterns/domain but contain zero verbatim source code. Solves IP, secrets, and dependency-untangling in one move; becomes the pitch.
2. **Component cartography first.** Real repos are heterogeneous (frontend + backend + APIs + infra). We partition into components (`components.json`) and treat the repo as a quarry — only in-lane components matter per role.
3. **Derive the role menu from the repo** rather than letting users request unsupported roles. "This repo supports Backend (strong), Data (strong), Frontend (none)" is both the UX fix and the demo moment.
4. **Role archetype = in-lane components + stub strategy + rubric template.** Out-of-lane dependencies become stubs/mocks/fixtures so the candidate repo runs standalone with one command.
5. **Seniority is a scope knob**: junior = bug hunt, mid = extension, senior = extension + design note. Not a separate system.
6. **Verification before packaging is non-negotiable.** Sandboxed install + test + planted-bug demonstrability + secrets scan + code-overlap check. An unverified package never ships.
7. **CLI-first, UI as a demo veneer.** Validation doesn't need a product surface; the demo does.
8. **Narrow first slice**: backend role × bug-hunt archetype × TS repos. Expand only after end-to-end works.
9. **PostHog deferred to v2** — it's the long-term differentiator (analytics/instrumentation take-homes from real event schemas) but adds OAuth friction that doesn't serve validation.

## Assets & audience

- Dogfood repos: `gtm-os-console`, `signal-engine` (Om's), + one mid-size OSS TS repo for neutral judging.
- First reviewers: Andrei (CEO) and Neal (CTO) at Om's company, plus ~3 engineering friends who run hiring loops.
- Builder toolchain: Claude Code (primary), possibly Codex for comparison. Anthropic API key available; agent invocations use Claude Code headless mode.

## Constraints

- Solo builder, nights/weekend. Every scope decision biases toward "smallest thing that produces a sendable package."
- No spend beyond API costs (~$1–3/run acceptable).
- Nothing candidate-facing gets built until reviewers validate the package quality.
