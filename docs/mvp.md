# Quarry — MVP Scope

Target: a weekend-to-one-week build using Claude Code. CLI-first core, thin UI for demos.

## In scope

**Input**
- Public GitHub repo URL, or local directory path.
- Private repos via `GITHUB_TOKEN` env var only (no OAuth).
- Repos whose primary languages are TypeScript/JavaScript or Python.
- Shallow clone (depth 1), size cap (default 200 MB, configurable).

**Pipeline** (detail in SPEC.md)
1. Ingest → file tree + manifest/stack detection
2. Cartography → `components.json` (partition repo into components)
3. Role menu → which roles this repo can assess, with strength ratings
4. Surface selection → 3–5 assessable surfaces for chosen role; user (or `--auto`) picks one
5. Generation → synthesized mini-repo + brief + rubric + answer key
6. Verification → sandboxed install + test run, secrets scan
7. Packaging → zip with candidate/ and interviewer/ folders

**Roles & archetypes**
- Role archetypes: `backend`, `frontend`, `fullstack`, `data` — **ship `backend` first**, others behind it.
- Task archetypes: `bug-hunt` (planted realistic bug; find, fix, add a test) and `extension` (ticket-style feature request) — **ship `bug-hunt` first**.
- Seniority knob: `junior` (bug hunt, one surface) / `mid` (extension) / `senior` (extension + design-note prompt).

**Interfaces**
- CLI: `quarry generate <repo> --role backend --seniority mid` runs end-to-end.
- UI: single-page Next.js app — URL field → role cards (from role menu) → generation progress stream → download zip. Nothing else.

## Out of scope (do not build, even if easy)

- PostHog / analytics anything
- Auth, accounts, multi-tenancy, persistence beyond local disk
- Candidate submission handling, grading, plagiarism/AI detection
- Non-TS/JS/Python stacks, Docker-in-Docker verification, cloud deploy
- Editing UI for generated packages (reviewers edit the markdown directly)

## Demo storyline (build toward this exact script)

1. Paste `signal-engine` URL → 30s later: "This repo supports **Backend (strong)**, **Data (strong)**, Frontend (none)."
2. Pick Backend / mid → watch stage progress → download zip in ~5–8 min.
3. Open `candidate/README.md` — one command installs and runs it. Open `interviewer/rubric.md`.
4. Punchline: "Your codebase, zero IP exposure, 8 minutes instead of 8 hours."

## Definition of done

`quarry generate` produces a package on both dogfood repos and one OSS repo, each package passing verification, and the UI can do the same flow in a browser. Then stop building and go show people (goals.md).
