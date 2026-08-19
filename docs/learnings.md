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

### Branching model (decided after Phase 0 shipped)

The repo was empty when Phase 0 started — zero commits, zero branches — so the first branch
pushed became GitHub's default branch, and there was no base to open a pull request against.
Resolved by promoting the Phase 0 tip to `main` and working phase-by-phase from there:

- One branch per phase, one PR per phase, merged after review. This lines up exactly with
  `CLAUDE.md`'s "stop for review at each phase boundary" — the PR *is* the review artifact,
  and it gives each phase a clean revert unit.
- CI (`.github/workflows/ci.yml`) gates every PR on `typecheck`, `lint`, `format:check` and
  `test`, so a PR means something rather than being a formality.
- CI pins **Node 20**, the floor declared in `package.json` `engines`, while local dev runs
  Node 22. A dependency on a newer runtime should fail in CI, not on someone's machine.
- **gitleaks is deliberately not in CI.** The official action wants a licence key in some
  account types, and a flaky secrets gate is worse than none. The invariant that matters is
  the S6 scan over the *generated package*, which runs locally in the pipeline. Revisit if
  repo-level secret hygiene ever becomes a real risk.
- Setting the repo's default branch is not exposed by the GitHub MCP tools, so that flip is
  a manual step in repo settings.

---

## Phase 1 — S1 Ingest

### Decisions

- **`ingest.json` is metadata only — paths, sizes, counts, no file contents.** Contents are
  read later, on demand, from the clone still sitting in the run directory. This keeps the
  artifact small (26 KB for Express) and makes the security story simple: what is not in the
  tree cannot reach a prompt.
- **Secret-bearing files are absent from the artifact, not listed.** Only a count survives,
  so a filename like `stripe-prod.key` never reaches an agent either. The CLI prints the
  count (`Excluded: 7 secret`) so the strip is visible rather than a silent no-op.
- **Secret matching deliberately over-excludes.** A missed config file costs an agent a
  little context; a leaked credential costs the customer their trust in the entire premise.
  `.env.example`/`.sample`/`.template` are the one carve-out — key names with empty values
  are genuinely useful stack signal. Verified against `psf/requests`, where all 7 exclusions
  were real `.key`/`.pem` test certificates.
- **Lockfiles are listed but never read.** SPEC S1 excludes "lockfile contents"; the path is
  a stack signal, the 40k lines are not. A missing `loc` field is the marker that a file was
  never opened.
- **Language `share` is computed over code only.** Markdown, JSON and YAML are still counted
  and reported, but with a share of 0 — otherwise a docs-heavy repo reports as a Markdown
  repo and S3's role scoring would be badly misled.
- **A local directory is copied into the run dir, not read in place**, so later stages can
  never mutate someone's working tree and a run directory stays a complete record of itself.
- **Per-file ceiling of 512 kB** (`too-large`), separate from the 200 MB repo cap. A
  generated API client or a checked-in dataset would otherwise dominate the walk and every
  downstream token budget while teaching an agent nothing.
- **The size cap is checked during the walk, not after**, so an oversized repo fails in
  seconds. Note the limitation: for a URL the clone still happens first, because knowing the
  size beforehand would mean a GitHub API call that `architecture-mvp.md` explicitly avoids.

### Bugs caught while building

- **`requirements/dev.txt` was not detected as a manifest.** The basename regex only matched
  `requirements*.txt`, missing the very common `requirements/` directory layout. Caught by a
  test written before the fix; the implementation changed, not the expectation.
- **A local path inside another git checkout was labelled with the enclosing repo's commit.**
  `git rev-parse HEAD` run in a subdirectory happily reports the parent repo's SHA, so the
  fixture was being stamped with Quarry's own commit. Now a commit is recorded only when
  `--show-toplevel` equals the resolved path.
- **`tsbuildinfo` lived next to `tsconfig.json`, not in `dist/`.** So `rm -rf dist` left
  stale build state behind and `tsc -b` then insisted everything was up to date while
  emitting nothing — the CLI binary silently vanished. Both packages now set
  `tsBuildInfoFile: dist/.tsbuildinfo`. Worth remembering: `pnpm clean` (`tsc -b --clean`)
  was always correct; hand-deleting `dist` was the trap.

### Noted for later phases

- **Phase 2 needs the curated context builder it already plans for.** `pnpm/pnpm` produces a
  **1 MB** `ingest.json` with 5,691 files and 1,458 manifests. Feeding that to S2 raw would
  be both expensive and useless, which is exactly why `architecture-mvp.md` specifies curated
  context (ingest + README/docs + manifests) rather than the whole tree.
- **Phase 3 will meet repos whose primary language is out of scope.** `pnpm/pnpm` reports
  Rust at 62% of code LOC (1,320 real `.rs` files) ahead of TypeScript at 37%. `mvp.md`
  limits Quarry to TS/JS and Python, so S3's role scorer needs a sensible answer for
  "the biggest thing here is a language we do not assess" rather than assuming the top
  language is the relevant one.

---

## Phase 2 — Agent wrapper + S2 Cartography

### The CLAUDE.md leak (found by testing, not by reading)

`claude -p` auto-discovers CLAUDE.md by walking **up** from its working directory. Quarry's
`work/` lives inside Quarry's own checkout, so every agent call started there would silently
carry Quarry's working agreement into the prompt — an agent asked to map someone else's repo
would be reading instructions about synthesis rules and phase discipline.

Verified rather than assumed: asked a headless run inside the repo whether its context
mentioned a project called Quarry, and it said **yes**. From a temp directory outside the
repo, **no**.

So `runAgent()` defaults to a fresh temp dir outside the repo, and there is a test asserting
the cwd it hands the transport is not inside the checkout. **This will bite again in Phase
4**: S5 runs Claude Code *inside* the target directory it is writing into, which lives under
`work/`. That stage needs its own answer — most likely generating into a temp dir and moving
the result into the run directory afterwards.

### Agent invocation flags

Every call passes flags that would otherwise let the operator's machine leak into results:

- `--strict-mcp-config` with no `--mcp-config` — no MCP servers. Without it, every Quarry
  call drags in whatever connectors the user has configured, at real token cost and with
  real nondeterminism.
- `--setting-sources ''` — ignore user/project/local settings.
- `--disable-slash-commands` — the operator's skills are not part of this contract.
- `--system-prompt` — replaces Claude Code's default system prompt, which is written for
  interactive coding and is both large and off-task.

Measured effect of the lean configuration on a trivial call: **$0.263 → $0.189**. The floor
is ~31k cache-creation tokens of tool definitions, which there is no flag to remove.

### Observed costs and latency (useful against the architecture doc's $1–3 per run)

| Repo | Components | Attempts | Cost | Wall clock |
|---|---|---|---|---|
| `mini-ts-api` fixture | 1 | 1 | $0.04 | 11 s |
| `trpc/trpc` | 11 | 1 | $0.41 | 87 s |
| `pnpm/pnpm` | 5 | 1 | $0.47 | 87 s |

No retries were needed on any real repo, which is a good sign for the prompt but means the
retry path is only covered by unit tests with an injected transport.

### The curated context builder, and two starvation bugs it had

`architecture-mvp.md` calls for curated context; the shape chosen is a **directory map**
(per-directory file counts, LOC and top languages, depth-limited) plus **manifest contents**
plus **doc contents**. The raw tree is never sent. Compression achieved: `pnpm/pnpm`'s 1 MB
`ingest.json` renders to a 111 kB context.

Two bugs surfaced only by running it against real repos:

1. **Manifests starved docs.** With one shared byte budget, `pnpm/pnpm`'s 1,458 manifests
   consumed the entire allowance and the agent received **zero prose** — on the repo that
   most needed it. Fixed with `manifestShare` (0.55): manifests still get first refusal, but
   cannot take everything, and unspent allowance flows to docs.
2. **The directory map had no budget at all.** A synthetic 60-package repo showed the map
   eating the whole allowance before manifests were reached; a few thousand directories
   would starve manifests *and* docs. Fixed with `directoryShare` (0.3): when rows do not
   fit, the directories with the most code are kept and the rest are counted in a trailing
   note, so the map degrades into a summary rather than being cut off mid-tree.

The fix visibly improved output: `pnpm/pnpm` went from 7 components with no doc attributions
to 5 better ones citing real documentation paths — consolidating a spuriously split `pnpr`
and dropping a directory that was never a component.

### Decisions

- **Referential integrity is enforced in the zod schema, not afterwards.** A `depends_on`
  pointing at a non-existent id, a self-dependency, or a duplicate id fails the parse — so
  the agent gets told about it and retries, rather than S3 tripping over it later.
- **Retry feedback names the specific failure.** The zod issues are appended to the original
  prompt, and each retry carries exactly one rejection block rather than compounding. A bare
  "try again" tends to reproduce the same malformed shape.
- **Prompt templates use `{{PLACEHOLDER}}` substitution and nothing else** — no conditionals,
  no loops. A prompt with logic in it is a prompt nobody can review. Missing values throw
  rather than sending a literal `{{CONTEXT}}` to the agent.
- **The prompts directory resolves via `import.meta.url`** at the same relative depth from
  `src/` and `dist/`, so it works under vitest and from the build without a copy step.
- **The model is not pinned.** `--model` is plumbed through and defaults to the CLI's choice.
  Pinning would be more reproducible but goes stale; revisit if results start drifting.
- **`--json-schema` was left unused.** The CLI offers structured-output validation, which
  would reduce retries, but `architecture-mvp.md` specifies zod-parse-and-retry and that is
  what is built. Worth revisiting as a belt-and-braces addition once the pipeline is proven.

### Noted for later phases

- The retry path has never fired against a real repo. If Phase 3's S4 prompt is harder to
  satisfy, watch whether two retries is actually enough.
- `trpc/trpc` hit the manifest ceiling exactly (40 of them). If a repo needs more than 40
  manifests to be understood, the cap — not the byte budget — is what will bite first.

### CI caught a Node-version trap that local testing could not

Phase 2 merged with red CI (the merge landed before the run finished). The failure:

```
TypeError: TEXT_ENCODINGS.union is not a function
  ❯ node_modules/.pnpm/execa@10.0.1/.../encoding-option.js:20:34
```

`Set.prototype.union` is Node 22+. **execa 10 declares `engines: {node: ">=22"}`**, but pnpm
does not enforce engine ranges by default, so it installed cleanly, passed every local check
on a Node 22 dev machine, and broke only on CI's Node 20 — the floor declared in
`package.json`.

This is precisely what pinning CI to the floor was for, written in the Phase 0 commit as
"anything that quietly depends on a newer runtime fails in CI instead of on a contributor's
machine". It worked.

Fixed by downgrading to **execa 9** (`^18.19.0 || >=20.5.0`), keeping the Node 20 floor that
`architecture-mvp.md` documents. Per CLAUDE.md, architecture wins on implementation, so the
smallest correct move was to change the dependency rather than the documented floor.

Verified rather than assumed: downloaded Node 20.19.5, reproduced the exact original failure
on it with execa 10, then confirmed all 190 tests pass on the same Node 20 with execa 9, plus
a live agent call through the downgraded API.

`engine-strict=true` is now set in `.npmrc`, but be clear about what it does and does not do:
pnpm checks a dependency's engine range against the **running** Node, not against the floor
in `package.json`. So it gives a Node 20 user a clear install error instead of a baffling
runtime crash — but it would **not** have stopped a developer on Node 22 from adding this
dependency. Only CI-on-the-floor catches that.

**Open question for the maintainer, not decided here:** Node 20 reached end of life in April
2026, and GitHub is deprecating Node 20 on Actions runners. Keeping the floor at 20 is
currently costing a major version of one dependency. Raising it to 22 would contradict
`architecture-mvp.md` as written, so it needs an explicit decision rather than a silent drift.

### Out-of-scope temptations logged, not built

- _(none yet)_
