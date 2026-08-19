# Quarry — MVP Task Plan

Rules: work top to bottom. Check items off in this file as they're completed. Each phase ends with something runnable. Don't start a phase until the previous phase's acceptance check passes. Narrow first slice: **backend role + bug-hunt archetype on a TS repo** — everything else comes after Phase 6.

## Phase 0 — Scaffold
- [x] pnpm workspace: `packages/core`, `packages/cli`, `apps/web` (web can be empty stub)
- [x] TS strict config, vitest, eslint/prettier, `work/` gitignored
- [x] `quarry --help` runs via `packages/cli`
- ✅ Check: `pnpm test` green on a placeholder test; CLI prints help.

## Phase 1 — S1 Ingest
- [x] Clone (URL, shallow) or copy (local path) into `work/<run>/repo`, size cap enforced
- [x] File walk → tree with sizes; exclusions (`.git`, `node_modules`, `.env*`, secret patterns, binaries)
- [x] Manifest + language detection → `ingest.json` (zod schema in `schemas/`)
- [x] Unit tests with a fixture mini-repo checked into `packages/core/test/fixtures`
- ✅ Check: `quarry ingest <url>` produces valid `ingest.json` on a real public repo.

## Phase 2 — Agent wrapper + S2 Cartography
- [ ] `runAgent()` wrapper: execa → `claude -p --output-format json`, zod parse, 2 retries with error feedback
- [ ] `prompts/s2-cartography.md` with components.json contract
- [ ] Curated context builder (ingest.json + README/docs + manifests only)
- ✅ Check: `quarry map <url>` emits sane `components.json` for (a) a single-app repo and (b) a monorepo.

## Phase 3 — S3 Role menu + S4 Surface selection
- [ ] Deterministic role scorer (pure function + unit tests) → `roles.json`
- [ ] Hard error on `none` roles with reason
- [ ] `prompts/s4-surfaces.md`; context scoped to in-lane component files → `surfaces.json`
- [ ] `--auto` picks top-scored surface
- ✅ Check: `quarry roles <url>` prints the role card table; `quarry surfaces <url> --role backend` lists 3–5 surfaces with scores.

## Phase 4 — S5 Generation (backend × bug-hunt only)
- [ ] Archetype definitions as data (`archetypes/roles.ts`, `archetypes/tasks.ts`) per SPEC table
- [ ] Reference-material selector (≤ 40 files / 150 KB from surface definition)
- [ ] `prompts/s5-generate.md`: synthesis rule, stub rule, one-command run, no external services
- [ ] Emits `candidate/` (repo + README + BRIEF.md), `interviewer/` (rubric.md, answer-key.md, verify.test.*), `meta.json`
- ✅ Check: generation completes on fixture repo; output *looks* right by eye (verification is next phase).

## Phase 5 — S6 Verify + S7 Package
- [ ] Sandbox runner: scrubbed-env subprocess, install (5 min) + test (3 min) timeouts
- [ ] Bug-demonstrability check (verify test fails on starter, passes on patched)
- [ ] 8-line shingle overlap check vs. source repo
- [ ] gitleaks over package dir
- [ ] One repair loop on failure, then hard fail with logs
- [ ] `archiver` zip + final CLI output
- ✅ Check: `quarry generate <fixture> --role backend --seniority junior --auto` → verified zip.

## Phase 6 — End-to-end hardening
- [ ] Run against dogfood repos: `gtm-os-console`, `signal-engine`, one OSS repo
- [ ] Fix whatever breaks; capture failure patterns in `docs/learnings.md`
- [ ] Add `extension` task archetype + `mid`/`senior` seniority behaviors
- ✅ Check: SPEC acceptance criteria 1–5 pass.

## Phase 7 — Remaining roles
- [ ] `data` archetype (second priority — dogfood repos support it)
- [ ] `frontend` + `fullstack` archetypes (only if a demo repo warrants them)
- ✅ Check: one monorepo yields packages for 2 roles (goals.md metric 5).

## Phase 8 — Demo UI
- [ ] Next.js single page: URL input → role cards from `roles.json` → seniority picker → SSE stage progress → download button
- [ ] API route wraps core pipeline; no persistence beyond `work/`
- ✅ Check: full browser flow on a dogfood repo; SPEC acceptance 6.

## Phase 9 — Demo prep (human tasks, not Claude Code)
- [ ] Record 3-min Loom of the demo storyline (mvp.md)
- [ ] Generate 3 sample packages to hand reviewers
- [ ] Run the 5 reviewer interviews; log answers against goals.md metrics
