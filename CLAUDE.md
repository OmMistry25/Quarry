# CLAUDE.md — Quarry

You are building **Quarry**: a tool that reads a GitHub repo and generates a role-specific, verified take-home test package (candidate mini-repo + brief + rubric + answer key).

## Read order (before writing any code)

1. `docs/mvp.md` — what's in and out of scope
2. `docs/SPEC.md` — what each pipeline stage does (source of truth for behavior)
3. `docs/architecture-mvp.md` — stack, layout, and technical decisions (source of truth for *how*)
4. `docs/tasks-mvp.md` — your work queue
5. `docs/context.md`, `docs/goals.md`, `docs/idea-overall.md` — background; skim once

If SPEC and architecture ever conflict, SPEC wins on behavior, architecture wins on implementation; flag the conflict in your summary rather than silently choosing.

## How to work

- Follow `docs/tasks-mvp.md` strictly top-to-bottom. Check items off in that file as you complete them. Do not skip phase acceptance checks.
- Small commits, one per task or tightly related group, message format: `phase-N: <what>`.
- TypeScript strict mode; every zod schema gets a unit test; every pipeline stage gets at least one test against the fixture repo.
- Prompts for agent stages live in `prompts/` as markdown — treat them as code (versioned, reviewed, no inline prompt strings in TS).
- When something in the docs is ambiguous, make the smallest reasonable choice, note it in `docs/learnings.md`, and continue — don't stall.

## Hard invariants (never violate, never "temporarily" disable)

1. **Synthesis rule**: files in `candidate/` must contain zero verbatim source-repo code. The 8-line overlap check in S6 enforces this; if it fails, fix generation, don't loosen the check.
2. **No secrets in context**: `.env*` and secret-pattern files are stripped at S1, before any agent call.
3. **Never package an unverified run**: S6 (install + tests + bug demonstrability + gitleaks + overlap) must pass before S7 zips anything.
4. **One-command candidate setup**: generated repos install and run with a single documented command, no external services.
5. **Scope**: nothing from the "Out of scope" list in `docs/mvp.md` — even if it seems easy.

## Environment & commands

- `pnpm install` / `pnpm test` / `pnpm lint` at root
- CLI during dev: `pnpm --filter cli dev -- generate <repo> --role backend --auto`
- Agent calls shell out to `claude -p --output-format json` (see `packages/core/src/agent/`); assume `claude` and `gitleaks` are on PATH — if missing, say so in your summary rather than mocking them silently.
- `work/` is scratch space and gitignored. Never commit anything under `work/`, cloned repos, or generated packages.
- Needed env: `ANTHROPIC_API_KEY` (for headless runs if required), optional `GITHUB_TOKEN` for private clones. Never hardcode either.

## Testing philosophy

- Fixture-first: `packages/core/test/fixtures/mini-ts-api/` is a tiny fake Express repo used by all stage tests — build it early (Phase 1) and keep it under 30 files.
- Agent stages get two test modes: schema tests with recorded JSON outputs (fast, default), and a `LIVE=1` mode hitting the real agent (manual).
- End-to-end smoke (`pnpm e2e`) = full pipeline on the fixture repo; must stay green from Phase 5 on.

## When you finish a phase

Post a short summary: what was built, acceptance check result, any deviations logged in `docs/learnings.md`, and what's next. Then stop for review — don't auto-continue past a phase boundary unless told to.
