# Quarry — MVP Architecture

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Language | TypeScript (Node 20+), pnpm workspace | One language across core + UI; Claude Code is strongest here |
| Core | `packages/core` — library + pipeline stages | Testable without UI |
| CLI | `packages/cli` — thin wrapper (commander) | Fastest path to end-to-end; primary interface for validation |
| UI | `apps/web` — Next.js 14 (app router), single page | Demo only; calls core via API route that streams stage events |
| Git | `simple-git`, shallow clone | Cheap, no GitHub API needed for public repos |
| Agent | Claude Code headless: `claude -p <prompt> --output-format json` via `execa`; alternative: Anthropic Agent SDK | Repo exploration, file generation, and tool use for free — we don't build RAG |
| Validation | `zod` schemas for every agent JSON output | Agents drift; parse, don't trust |
| Sandbox | Subprocess in temp dir with timeouts + env-scrubbed shell | Docker is v2; local subprocess is enough for MVP (only runs code the agent just wrote) |
| Secrets scan | `gitleaks` binary invoked on package dir | Battle-tested, zero code |
| Zip | `archiver` | — |

## Repo layout (of Quarry itself)

```
quarry/
  CLAUDE.md
  docs/                  # these planning files
  packages/
    core/
      src/
        stages/          # s1-ingest.ts ... s7-package.ts
        archetypes/      # role + task archetype definitions (data, not code)
        agent/           # claude invocation wrapper, retry, zod parsing
        schemas/         # zod: ingest, components, roles, surfaces, meta
        verify/          # sandbox runner, overlap check, gitleaks wrapper
      test/
    cli/
  apps/web/
  prompts/               # one .md prompt template per agent stage
  work/                  # gitignored: clones, stage outputs, packages
```

## Data flow

```
repo URL/path
   │  S1 ingest (simple-git, fs walk)          → work/<run>/ingest.json
   │  S2 cartography (agent + zod)             → work/<run>/components.json
   │  S3 role menu (pure function)             → work/<run>/roles.json
   │  user picks role/seniority (or --auto)
   │  S4 surface selection (agent, scoped ctx) → work/<run>/surfaces.json
   │  S5 generation (agent, writes files)      → work/<run>/package/{candidate,interviewer}
   │  S6 verify (subprocess + gitleaks
   │            + overlap check)               → meta.json verification block
   │  S7 package (archiver)                    → work/<run>/quarry-*.zip
```

Every stage is a pure-ish function `(runDir, config) → artifact file`, so stages are resumable (`--from s5`) and independently testable. `runDir` is the only shared state.

## Agent invocation design

- One prompt template per stage in `prompts/`, with the JSON contract stated in the prompt and enforced by zod on return.
- Wrapper: `runAgent(stage, context, schema, {retries: 2})` — on parse failure, re-prompt with the zod error appended.
- S2/S4 receive *curated* context (ingest.json + selected file contents), never the raw repo — keeps token cost bounded. S5 runs Claude Code *inside* an empty target dir with write access, with the surface's relevant source files provided read-only as reference material.
- Context budget: cap reference material fed to S5 at ~40 files / 150 KB, chosen by S4's surface definition.

## Verification details

- Install: `pnpm install` / `pip install -r requirements.txt` (per generated stack), 5-min timeout.
- Tests: the package's documented test command, 3-min timeout.
- Bug-demonstrability: run `interviewer/verify.test.*` twice — against starter (must fail) and against a patched copy applying the answer-key fix (must pass).
- Overlap check: shingle (8-line window) hashes of source repo vs. candidate files; any match fails the run (SPEC acceptance #4).
- Repair loop: on S6 failure, feed stderr + failing check into one S5 retry. Second failure = hard fail with logs in `work/<run>/logs/`.

## Cost & latency envelope (order of magnitude)

- S2 + S4: 2 agent calls, small context — seconds to ~1 min.
- S5: the big one — a Claude Code session writing 10–25 files; expect 2–6 min and the majority of token spend.
- Whole run target: < 10 min, roughly $1–3 in API cost per package at current pricing. Fine for validation.

## Security notes

- `.env*` and secret-pattern files stripped at S1, before any agent context.
- Sandbox subprocess runs with a scrubbed env (no inherited API keys) and inside `work/` only.
- `work/` is gitignored; packages contain zero source-repo code by construction + verified by overlap check.

## Non-goals reflected in architecture

No database, no queue, no auth, no deploy config. Local disk + subprocesses only. If it validates, v2 re-architects for hosting.
