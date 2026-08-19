# Quarry

Point Quarry at a GitHub repo and get a complete, role-specific take-home test: a runnable
starter mini-repo, a candidate brief, a grading rubric, and an interviewer answer key —
generated from the patterns in _your_ codebase, without shipping any of your actual code.

The repo is a quarry: Quarry extracts patterns, not code. Generated candidate repos mirror
the source repo's stack, conventions and domain flavour, but every file is written fresh and
an automated overlap check enforces that.

## Status

Early build. See `docs/tasks-mvp.md` for the phase plan and what currently works.

## Prerequisites

| Tool                                               | Why                                                        |
| -------------------------------------------------- | ---------------------------------------------------------- |
| Node ≥ 20, pnpm                                    | Runtime and workspace manager                              |
| `git`                                              | Shallow clone of the target repo (S1)                      |
| [`claude`](https://claude.com/claude-code) CLI     | Agent stages shell out to it in headless mode (S2, S4, S5) |
| [`gitleaks`](https://github.com/gitleaks/gitleaks) | Secrets scan over the generated package (S6)               |

Auth: the `claude` CLI needs a working login, or `ANTHROPIC_API_KEY` set. `GITHUB_TOKEN` is
optional and only needed for private repos.

## Commands

```bash
pnpm install       # install the workspace
pnpm test          # vitest
pnpm lint          # eslint
pnpm typecheck     # tsc across packages and tests
pnpm build         # compile packages/core and packages/cli

pnpm --filter cli dev -- --help
pnpm --filter cli dev -- map https://github.com/owner/repo
pnpm --filter cli dev -- roles https://github.com/owner/repo
pnpm --filter cli dev -- surfaces https://github.com/owner/repo --role backend --auto
pnpm --filter cli dev -- generate https://github.com/owner/repo --role backend --seniority junior --auto
```

Agent-stage tests run against recorded replies by default. `LIVE=1 pnpm test` runs them
against the real `claude` CLI instead — slower, and it spends real tokens.

CI runs `typecheck`, `lint`, `format:check` and `test` on every pull request and on pushes
to `main`, against Node 20 (the floor declared in `engines`).

## Layout

```
packages/core   pipeline stages, zod schemas, agent wrapper, verification
packages/cli    commander CLI (the primary interface)
apps/web        demo UI — placeholder until Phase 8
prompts/        one markdown prompt template per agent stage (versioned like code)
docs/           scope, spec, architecture, task plan, learnings
work/           gitignored scratch: clones, stage artifacts, generated packages
```

`CLAUDE.md` is the working agreement for anyone — human or agent — building on this.
