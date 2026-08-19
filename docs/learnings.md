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

---

## Phase 3 — S3 Role menu + S4 Surface selection

### The Rust question, answered

Phase 1 flagged that `pnpm/pnpm` reports Rust at 62% of code LOC while `mvp.md` scopes Quarry
to TS/JS and Python. The resolution: **role scoring counts only assessable-language LOC**, and
when in-lane components exist but are dominated by a language Quarry cannot generate a
take-home in, the rating is `none` with a reason that names the language — not `weak`. A
verdict of "weak" would imply "try anyway"; the truth is "this repo has a substantial backend
and Quarry still cannot help with it".

### A scoring bug caught by running against a real repo

`expressjs/express` scored **Backend WEAK, "no tests found"** — for one of the better-tested
repos in the ecosystem. S2 had mapped it correctly: `lib/**` as the backend component, and a
separate `other` component holding `test/**` with 112 files and 13,501 lines. The scorer only
counted files inside *in-lane* components, so the entire test suite was invisible.

That layout — a top-level `test/` beside `lib/` or `src/` — is standard in Python and common
in JS, so this systematically under-rated exactly the repos that make the best assessments.
Fixed by also counting test files that sit in a **neutral** component (`other`, `docs`,
`infra`) or in no component at all, while still excluding tests inside *another role's* lane
so a frontend suite cannot make a backend look well tested. Express now scores **STRONG,
15,834 assessable loc, 85% of it tests** — which is accurate; express really does have more
test code than library code.

### Decisions

- **Test coverage is the most heavily weighted signal** (35 of 100). A bug-hunt task needs
  somewhere for a candidate's test to live, and a repo with no tests gives the generator no
  conventions to imitate.
- **Isolation is the most heavily weighted surface score** (0.4 of 1.0). A surface that cannot
  be lifted out without dragging three components with it fails the one-command-setup
  invariant no matter how interesting it is.
- **Ranking happens in Quarry, not in the agent.** The agent returns three scores per surface;
  the weighting and sort are code, so `--auto` is reproducible and the weighting is
  inspectable. `--auto` resolves through the same `pickSurface()` that S5 will call rather
  than assuming the top of the printed list.
- **S4 validates ids and paths against reality inside the zod schema.** A hallucinated file
  path or a component id that is not in-lane becomes a retry with a specific complaint, not a
  broken S5 input.
- **Fullstack requires both sides of the seam.** A repo with only an API supports backend, not
  fullstack — SPEC describes fullstack as "one vertical slice across the seam".
- **S4's context is shaped differently from S2's, deliberately.** Cartography needed to know
  what exists, so it got manifests and prose. Surface selection has to judge isolation and
  richness, which cannot be told from a directory listing — so it spends its budget on source
  code, ranked entrypoints first, then tests, then by size.
- **Component path globs are matched forgivingly.** `trpc/trpc` really produced
  `["www/**", "!www/og-image/**"]`, and agents drop trailing `/**` from bare directories
  routinely. Both are handled; a component with only exclusions matches nothing rather than
  everything.

### The retry path fired for real, and I could not see why

An S4 run on the fixture rejected attempt 1 with `schema-mismatch` — the first real retry
outside a unit test. The reason existed only in memory and the run was not reproducible, so
**what failed is unknown**. That gap is now closed: every agent attempt, with its full
rejection detail, is appended to `work/<run>/logs/agent.log`, and the CLI prints the reason
rather than just the outcome. Worth watching in Phase 4, since a rejected attempt is the most
useful signal there is for improving a prompt.

### Observed costs

| Command | Repo | Cost | Wall clock |
|---|---|---|---|
| `roles` (S1–S3) | `expressjs/express` | ~$0.15 | 16 s |
| `surfaces` (S1–S4) | fixture | ~$0.10 | 40 s |
| `surfaces` (S1–S4) | `expressjs/express` | ~$0.23 | 76 s |

S3 itself is free — it is a pure function, so the same inputs always produce the same menu.

### Noted for later phases

- **Every command re-runs the whole pipeline.** `quarry surfaces` pays for S2 again even when
  a run directory with a perfectly good `components.json` already exists.
  `architecture-mvp.md` anticipates this with `--from s5` resumability; it is not built yet,
  and it will start to hurt during Phase 4 iteration.
- The `--json-schema` CLI flag remains unused, as recorded in Phase 2.

---

## Phase 4 — S5 Generation

### The CLAUDE.md leak, in its hardest form

Phase 2 solved this by running agents in a temp directory outside the repo. S5 could not
simply inherit that, because it genuinely needs a *writable* working directory — and
`work/<run>/package` sits inside Quarry's own checkout, so generating there would feed
Quarry's working agreement to the generator as instructions.

Resolution: generate into `mkdtemp()` outside the repo, then copy the result into the run
directory and delete the temp dir. There is a test asserting the cwd handed to the transport
is not inside the checkout, and a test that no temp directory survives a failed run.

### Write mode

S5 needed a second kind of agent invocation, so `AgentInvocation` gained a `mode`:

- `analyse` (S2, S4) — no tools; the context is already in the prompt.
- `write` (S5) — `--permission-mode acceptEdits` plus an explicit
  `--allowedTools Read Write Edit Glob Grep`.

`acceptEdits` rather than skipping permissions wholesale, and **no Bash**: a generation pass
cannot install packages, run tests, or reach the network. Running generated code is S6's job,
in a sandbox. Verified by probe before building anything on it.

### First real generation, measured

`quarry generate <fixture> --role backend --seniority junior --auto`:

| | |
|---|---|
| Wall clock | **7m 18s** (S5 alone ~6m) |
| Cost | **$1.60** total for S1–S5 |
| Output | 16 files in `candidate/`, 3 in `interviewer/` |

Comfortably inside the architecture doc's "$1–3 per package" and "< 10 min" envelope, though
the fixture is tiny — a real repo will cost more.

### The package was checked by hand, not just by eye

The Phase 4 acceptance bar is "looks right by eye", but most of S6 could be run manually, and
was — which de-risks Phase 5 considerably:

- **One-command setup**: `npm install` → 193 packages, 16s. SQLite, no external services.
- **Shipped tests pass against the planted bug**: 8 passed. This matters — a bug the shipped
  suite already catches is not a bug hunt, since `npm test` would find it immediately.
- **Bug demonstrability**: `interviewer/verify.test.ts` **fails** on the starter (expected 200,
  got 422), **passes** after applying the answer-key fix, and the shipped tests still pass
  afterwards. That is the S6 check, proven by hand.
- **gitleaks**: clean.
- **Quality**: BRIEF.md reads as a genuine support escalation — symptom without cause, no file
  named, real business impact, reproduction steps. The planted bug is `next <= 0` instead of
  `next < 0`, with a comment above it stating the *correct* intent, which is exactly what
  makes it plausible. The rubric uses the five backend dimensions with weights summing to 100.
- **Domain fictionalised** as SPEC requires: warehouse inventory became clinic supply
  dispensations. Same shape, different nouns.

One soft contract miss: the prompt asks for 5–8 debrief questions and the generator wrote 10.
Not worth a brittle check.

### The overlap-check question, now answered by evidence — needs a decision

Phase 0 predicted this and pre-committed to raising it rather than quietly carving out an
exemption. Running an ad-hoc 8-line shingle check over the generated package against the
source fixture:

- **Code files: zero overlapping blocks.** The synthesis rule holds where it matters.
- **One hit, in `package.json`**: the dependency block, because both declare
  `better-sqlite3 ^11.0.0`, `express ^4.19.2`, `zod ^3.23.8` in the same conventional order.

This one cannot be fixed in generation without making the output worse. The generated repo is
*supposed* to mirror the source's stack at compatible versions — that is the stub rule
working. Forcing divergence would mean deliberately picking different library versions, which
no reviewer would thank us for.

There is also a wording tension between the two source documents:

- **CLAUDE.md invariant 1**: "zero verbatim source-repo **code**". A dependency version list
  is not code, and this reading permits the exemption.
- **SPEC acceptance #4**: "**No file** in `candidate/` matches any ≥ 8-line block". This
  reading does not.

Recommendation, for the maintainer to decide before Phase 5 implements S6: keep the check
byte-strict over every file that can carry logic, and exempt only a named allowlist of
dependency manifests (`package.json`, `package-lock.json`, `pnpm-lock.yaml`,
`requirements.txt`, `pyproject.toml`), with the allowlist itself covered by a test. Not
implemented — flagged.

### Noted for later phases

- S5 is slow enough (~6 min) that Phase 5's repair loop will roughly double a failing run.
  The absence of `--from` resumability is now the most expensive missing affordance.
- `meta.json` carries `generation.referenceFiles` — the exact list of source files the
  generator was allowed to read. That is the audit trail if a package is ever challenged on
  invariant 1.

---

## Phase 5 — S6 Verify + S7 Package

### The overlap-check decision, as settled

Dependency manifests (`package.json`, lockfiles, `requirements.txt`, `pyproject.toml`) are
exempt; everything that can carry logic stays byte-strict, including `tsconfig.json` and
`vitest.config.ts`. A generated repo is *supposed* to declare the same libraries at the same
versions — that is the stub rule working — and a dependency list leaks nothing S2 does not
already report openly. The allowlist has its own test, and a test proves a copied source file
still fails in a repo that also contains an exempt manifest.

### The fix had to become code

SPEC's bug-demonstrability check needs the answer-key fix *applied*, but the answer key is
prose. S5 now also writes `interviewer/fix/`, containing the complete corrected version of
every file the fix touches, at the same path it has inside `candidate/`. S6 copies
`candidate/`, overlays those files, and re-runs the verification test. Full corrected files
rather than a diff: no patch-application fuzz, and the reviewer can read the fix directly.

### Two real bugs the tests found

Both were in the product, not the tests, and neither would have surfaced without running the
checks against deliberately broken packages.

1. **Killing the shell did not kill its children.** `execa`'s timeout terminated the shell,
   but any process it had spawned survived, kept the pipe open, and the await blocked for the
   *child's* full lifetime. A 300 ms timeout took 5 s to return — so a hung `npm install`
   would have stalled the pipeline for its entire duration while being correctly reported as
   timed out. Fixed with `detached: true` plus a process-group kill: 5008 ms → 307 ms, with a
   regression test asserting the elapsed time, not just the flag.
2. **stdin was left open.** A bare `node` opened a REPL and waited forever. This is what a
   generated test command that reads stdin, or a package manager that asks to confirm, would
   have done to a real run. Fixed with `stdin: 'ignore'`.

### Decisions

- **The environment is an allowlist, not a denylist.** A new secret in the operator's shell
  must not become visible to generated code just because nobody thought to block it. There is
  a test asserting an unknown future token is dropped.
- **Verification works on a copy.** Installing writes `node_modules` and the bug-demo check
  mutates files; the packaged artifact has to stay exactly as generated. A test asserts the
  verification test never lands in the real package.
- **A failing install does not produce fake test results.** The tests step is explicitly
  marked skipped rather than run against a half-installed tree.
- **The repair loop regenerates rather than patches.** SPEC allows one loop; the generator has
  no memory of the previous attempt and cannot see the code it wrote, so asking it to fix
  something invisible produces worse results than asking it to write the package again
  knowing exactly what failed. The failures are appended to the S5 prompt verbatim.
- **gitleaks missing is a failure, not a skip.** `ran: false` is distinguished from a clean
  scan, and a package that could not be scanned is never shipped.
- **S7 checks the verification block itself** rather than trusting its caller, and rewrites
  `meta.json` with it — so the shipped package carries proof of what was checked rather than
  only a claim that it was.

### Process note

Nine tests were left failing for a while because adding the `interviewer/fix/` requirement to
S5 invalidated a Phase 4 test fixture, and the full suite was not re-run until later. Cheap to
fix, but the lesson is to run the whole suite after changing a stage's contract, not only the
tests for the stage being edited.

---

## Phase 6 — End-to-end hardening

### Correction to the dogfood assumption in context.md

`context.md` and `goals.md` treat the dogfood repos (`gtm-os-console`, `signal-engine`) as the
place the quality question gets answered — "would a reviewer recognise this as our code?".
Om has since pointed out that **those repos were written by Claude Code, not by hand.**

That materially weakens them as a quality signal. Mirroring recently-generated, conventional,
internally-consistent code is the *easy* case. The hard case — and the one every real
customer has — is a codebase written by several people over years: idiosyncratic conventions,
a wrapper everyone works around, naming that only makes sense with the history. Whether
Quarry can imitate *that* convincingly is the question that decides the product, and the
dogfood repos cannot ask it.

Consequences, applied to this phase:

- **Hardening prioritises mature, human-written OSS repos with a strong house style** over
  merely finding a TypeScript repo of the right size. A repo old and opinionated enough that
  someone who knows it would immediately spot a fake is worth more than three modern ones.
- **The dogfood runs stay, but prove something narrower**: that the pipeline survives a repo
  the author can inspect, and that `mvp.md`'s demo storyline (which opens by pasting the
  `signal-engine` URL) actually works. They are not the quality evidence.
- **`goals.md` metric 1 — five reviewers judging against codebases they know — was always the
  load-bearing measurement, and is now the only one that reaches the real question.** Worth
  weighting the reviewer interviews accordingly, and worth trying to get one run against a
  reviewer's own production repo, even locally on their machine.
- The "no IP leaves your org" pitch also lands differently on an agent-written repo, where
  there is little proprietary code to protect. Fine — Om is not the customer — but it means a
  demo built on the dogfood repos leaves the pitch's strongest argument unexercised.

### Limitation: the fullstack seam can live inside one component

`formbricks/formbricks` scores Backend STRONG and Frontend STRONG but Fullstack `none`, and
that is the scorer working as written rather than a bug: it has no `backend-api` component at
all. Its API routes live *inside* the Next.js `web` app, so S2 correctly maps one
`frontend-app` plus shared libraries and workers, and the fullstack archetype — which
requires a `frontend-app` and a `backend-api` to slice across — finds no seam.

A reviewer would reasonably call formbricks a fullstack repo. SPEC defines fullstack as "one
vertical slice across the seam", and in a Next.js application that seam is real but
*intra-component*: server actions and route handlers on one side, client components on the
other. Detecting it means reasoning about the seam inside a component rather than between
two, which the current kind-based rule cannot do.

Not fixed. It costs nothing on repos with a separate API (`documenso/documenso` scores
Fullstack STRONG), and the alternative — inferring intra-component seams — is a real piece of
design rather than a tweak. Worth revisiting if reviewers ask for fullstack tasks on
Next-style repos.

### Invariant 1 fired on real output — the most important result so far

Generating a **frontend** package from `documenso/documenso`, the overlap check rejected the
package for reproducing source code verbatim:

```
src/components/widget-preferences-form.tsx:127 <- apps/remix/.../branding-preferences-form.tsx:187

  const handleFormSubmit = form.handleSubmit(async (data) => {
    try {
      await onFormSubmit(data);
    } catch {
      return;
    }
    form.reset(form.getValues());
```

That is genuine copying rather than shared idiom: the `onFormSubmit` name, the bare
`catch { return; }`, and `form.reset(form.getValues())` in that exact sequence. A different
author writes it differently.

This matters more than any other single result in the project. The entire pitch — "your
codebase, zero IP exposure" — rests on that check, and until now it had only ever been proved
against a synthetic fixture. It caught a real violation and refused to package. It is not
theoretical, and the generator does sometimes copy.

Two things follow.

**Framework boilerplate is where copying happens.** Not the interesting logic, which gets
rewritten naturally, but the stereotyped glue: submit handlers, router setup, error
middleware, provider wrappers, test scaffolding. Idiomatic code converges, so reaching for the
obvious shape reproduces the reference exactly. The prompt now names this specifically, shows
the real violation as an example, and asks for a deliberately different choice in exactly
those places. Per CLAUDE.md invariant 1, the fix goes in generation, not the check.

**The repair loop degraded synthesis while chasing the reported failure.** Attempt 1 was
overlap-clean; the copying appeared in attempt 2, which was fixing a bug-demonstrability
problem. Under pressure to fix what it was told about, the generator leaned harder on the
reference material. The repair block now restates that every other check still applies and
names the synthesis rule first — fix what is listed *and* keep everything else.

### Bug-hunt is a structurally poor fit for the frontend role

Three frontend generations against `documenso/documenso` were rejected for the same reason:
the starter's own suite catches the planted bug, so the candidate would find it by running
the tests once. The third failed with **20 of its own tests failing**, after the planting
guidance had been added and had visibly worked on backend repos.

This is not a prompt problem. It is a difference in how the two kinds of test suite cover
behaviour:

- **Backend tests assert input/output pairs.** express's suite checked specific byte lengths
  and content types, which leaves gaps between assertions — the exact-zero case, the
  multi-byte body, the boundary nobody wrote a test for. A realistic bug fits in a gap.
- **Component tests assert observable UI state, broadly.** "hides the sticky bar until a
  field is edited", "disables the fields while branding is off", "offers an inherit option
  only for a scope that can inherit". A React form's suite covers rendered state so densely
  that almost any component bug changes something a test already asserts.

The generator is not being careless; there is very little room to plant in.

The design already carries the remedy: seniority is a scope knob, and `mid` selects the
**extension** archetype, which plants nothing. Frontend work is better assessed by asking a
candidate to build something than by hiding a defect for them to find — which matches how
frontend interviews usually run anyway.

Worth putting to reviewers directly, since it is a product question rather than a bug: should
`--role frontend --seniority junior` fall back to an extension, or refuse with an explanation?
Falling back silently would be the wrong kind of helpful — the seniority knob means something.

### The < 10 minute target is missed on real repos, and not by a little

Measured from the two verified packages, S5 generation **alone**:

| Repo | S5 generation | Cost | Attempts |
|---|---|---|---|
| `expressjs/express` | **874 s (14.6 min)** | $4.61 | 1 |
| `psf/requests` | **863 s (14.4 min)** | $5.39 | 1 |

SPEC acceptance 1 and `goals.md` metric 3 both require **repo URL → downloadable package in
under 10 minutes**, and `mvp.md`'s demo storyline promises "download zip in ~5–8 min". One
stage is already 45% over the budget for the whole pipeline, before ingest, cartography,
surface selection or verification. A run needing its repair loop took **31 minutes**.

The fixture hid this completely: it generates in ~6 minutes because it is 16 files.

This is not a bug and there is no obvious fix that is free. The time is spent writing 13–25
files of real code, so it scales with *output*, not with the reference material — trimming
input will not move it much. The levers, all of them trade-offs:

- **A faster model for S5.** `--model` is already plumbed through. Untested for quality, and
  S5 is the stage where quality matters most.
- **A smaller candidate repo.** SPEC says 10–25 files; the low end would be quicker and
  thinner.
- **Stream progress and let the wait be visible.** Phase 8's UI streams stage events, which
  changes how ten minutes *feels* without changing what it costs. The demo is a screen-share,
  not a race.
- **Change the target.** The number in the docs was written before anything had been
  measured against a real repo.

Worth deciding with the reviewer interviews in mind: a hiring manager waiting for a take-home
they will spend an hour reviewing may not care whether it took 8 minutes or 15. The 10-minute
figure was a guess, and it now has data against it. Not changed unilaterally — SPEC wins on
behaviour, and this is a stated acceptance criterion.

### Frontend does not work yet, and the reason is testable assertions about the DOM

**Result: backend works on two languages; frontend produces no verified package.**

| Repo | Role | Archetype | Result |
|---|---|---|---|
| `expressjs/express` | backend | bug-hunt | ✅ verified, 21 kB |
| `psf/requests` | backend | bug-hunt | ✅ verified, 19.8 kB |
| `documenso/documenso` | frontend | bug-hunt | ❌ ×3 — shipped suite catches the bug |
| `documenso/documenso` | frontend | extension | ❌ ×2 — starter fails its own tests |

Five generation attempts, both archetypes, every one rejected by S6 for the same underlying
reason: **the generated React tests do not pass against the generated React components.**
Failures are always testing-library assertions — an element expected absent that is present,
`getByTestId` matching several nodes, a hint that renders under a condition the component
does not implement.

The generator has no Bash tool by design (Phase 4), so it cannot run what it writes. For
backend code that is survivable: an assertion about a returned value or a status code is
easy to get right by reading. An assertion about rendered DOM is not — it depends on how
the whole tree renders, which is exactly the thing that needs executing to know.

So the difficulty is not the frontend *archetype* — its stub strategy produced a working
Vite + React + vitest + testing-library package that installs and runs, and the extension
variant was structurally perfect on its first live run (bug demonstrability correctly skipped,
`interviewer/` correctly holding only the rubric and answer key, overlap clean). The
difficulty is writing DOM assertions blind.

Options, none free, none taken here:

- **Let S5 run the tests.** Add Bash to the generation pass so it can iterate until its own
  suite passes. This is the fix that addresses the cause. It contradicts the Phase 4 decision
  to deny S5 a shell — which was made to keep generation off the network and out of package
  installs — and it would make the slowest stage slower still.
- **Ask for far simpler frontend tests.** Render, assert one thing, stop. Cheap to try, and
  the prompt now pushes this way generally, but it lowers the ceiling on what the starter
  demonstrates.
- **Ship backend first and say so.** `mvp.md`'s narrow slice was always backend, and the
  reviewer interviews are about whether a package is sendable, not about role coverage.

Recommended: the third for the MVP, the first for v2. Frontend is a known gap with a known
cause, not a mystery.

### Out-of-scope temptations logged, not built

- _(none yet)_
