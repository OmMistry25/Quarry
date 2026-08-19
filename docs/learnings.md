# Quarry — Learnings

Running log of ambiguities resolved, deviations taken, and things that broke. Per `CLAUDE.md`:
when the docs are ambiguous, make the smallest reasonable choice, record it here, and continue.

Also the parking lot for anything on the **out-of-scope** list in `docs/mvp.md` that looked
tempting mid-build — noted here instead of built.

---

## Phase 0 — Scaffold

### Environment

- **`gitleaks` was not on PATH.** Installed v8.28.0 from the pinned GitHub release tarball.
  Note for reproducibility: `api.github.com` is blocked in this container (HTTP 403), so
  "fetch the latest release" does not work — the download URL has to name a version. Ubuntu's
  apt also carries 8.16.0 if the release download is unavailable.
- **`ANTHROPIC_API_KEY` is unset**, but `claude -p --output-format json` works anyway: this
  container authenticates the CLI through a host-managed session. Verified with a live
  round-trip before relying on it. The Phase 2 agent wrapper must **not** assume the env var
  exists — it should let the `claude` CLI resolve its own auth and surface the CLI's error if
  neither path works, rather than pre-flighting on `ANTHROPIC_API_KEY`.

### Decisions

- **Workspace packages are named `core` and `cli`, unscoped.** `CLAUDE.md` documents
  `pnpm --filter cli dev -- generate …`; pnpm matches `--filter` against the full package
  name, so `@quarry/cli` would break the documented command. Unscoped names keep the docs
  literally correct. Nothing is published, so there is no namespace cost.
- **`apps/web` is a bare workspace member with no Next.js dependency.** `tasks-mvp.md` allows
  an empty stub in Phase 0 and defers the real UI to Phase 8; installing Next.js now would tax
  every `pnpm install` for nine phases of CLI work.
- **`packages/cli`'s `dev` script builds `core` first** (`pnpm --filter core build && tsx …`)
  rather than mapping `core` to source via tsconfig `paths`. Source-mapped `paths` collide
  with `rootDir` under project references (TS6059). The build is incremental and adds ~1s.
- **Core's tests import `../src/index.js` relatively**, not the `core` package name, so
  `pnpm test` never requires a build.
- **ESLint is configured without type-aware rules** (`tseslint.configs.recommended`, not
  `recommended-type-checked`). Type safety is already enforced by `pnpm typecheck` with
  `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; type-aware
  linting would roughly double lint time for largely overlapping coverage. Revisit if lint
  starts missing real bugs.
- **`exactOptionalPropertyTypes` is on.** It occasionally fights zod's inferred types. Kept
  deliberately — this codebase's whole premise is "parse, don't trust" — but if it forces
  awkward casts around schema output in Phase 1–2, that's worth recording here.

### Ambiguities found while reading the docs

- **The demo storyline is not reachable until Phase 6.** `docs/mvp.md`'s demo picks
  "Backend / **mid**", and SPEC acceptance criterion 1 uses `--seniority mid` — but `mid`
  means the `extension` archetype, which `tasks-mvp.md` does not add until Phase 6. Phase 5's
  own acceptance check correctly uses `junior`/bug-hunt. Not a contradiction, just ordering:
  SPEC acceptance 1 is a Phase 6 gate, not a Phase 5 one.
- **The delivered zip contains the answer key.** S6 says the bug-demonstrability test is kept
  in `interviewer/` and "never shipped in `candidate/`", while S7 zips all of `package/`. The
  zip is therefore *interviewer-facing*; the interviewer forwards `candidate/` to the
  candidate. Generated `README`s must say so plainly, or someone will mail the whole zip.
- **The 8-line overlap check will produce false positives on boilerplate.** A naive shingle
  flags ordinary `tsconfig.json` blocks, runs of imports, and licence headers as "verbatim
  source code". Invariant 1 forbids loosening the check, so the plan for Phase 5 is: shingle
  over 8 *normalised* lines (trailing whitespace stripped, blank lines dropped), **no
  file-type exemptions**, and treat every hit as a generation bug to fix. If config-file false
  positives turn out to dominate in practice, that gets recorded here and raised — not
  quietly carved out.

No SPEC-vs-architecture behavioural conflict found on the first read.

### Fixed while scaffolding

- **`pnpm --filter cli dev -- --help` was broken.** pnpm forwards the `--` separator itself
  into the child process's argv, where commander reads it as an options terminator and treats
  `--help` (or, later, a subcommand name) as a stray positional — so the exact dev invocation
  documented in `CLAUDE.md` failed with "too many arguments". `stripPassthroughSeparator()` in
  `packages/cli/src/program.ts` drops one leading separator. Worth knowing before Phase 1 adds
  `quarry ingest`, since every documented dev command uses this form.
- **`pnpm test` needed a build first.** The CLI test imports `core` by package name, which
  resolved through `node_modules` to `dist/`, so tests failed on a clean checkout. Fixed with
  an exact-match vitest alias (`/^core$/` → `packages/core/src/index.ts`) rather than by
  ordering a build in front of the test script — tests should not depend on build state.
- **CLI logic lives in `program.ts`, not `index.ts`.** `index.ts` is the `#!/usr/bin/env node`
  bin and does nothing but call `run()` and format errors. Importing a module with a top-level
  side effect from a test would run the CLI during the test run.

### Out-of-scope temptations logged, not built

- _(none yet)_
