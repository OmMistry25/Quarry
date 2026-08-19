# Quarry — Functional Specification (MVP)

Scope boundaries live in mvp.md. Technical design lives in architecture-mvp.md. This file defines *what* each stage does and what its inputs/outputs are.

## Definitions

- **Component** — a coherent sub-part of the repo (frontend app, API layer, worker, data pipeline, shared lib, infra).
- **Surface** — a self-contained workflow inside a component suitable for assessment (e.g., an API route + its service + its tests; a sync job; a data transform).
- **Role archetype** — a lens (`backend` | `frontend` | `fullstack` | `data`) defining which components are in-lane, what gets stubbed, and rubric dimensions.
- **Task archetype** — `bug-hunt` or `extension`.
- **Package** — the final zip delivered to the user.

## Pipeline stages

### S1. Ingest
- Input: repo URL or local path.
- Clone shallow (depth 1) into a work dir. Respect size cap; abort with a clear error if exceeded.
- Emit `ingest.json`: file tree (paths + sizes, excluding `.git`, `node_modules`, lockfile contents), detected manifests (package.json, pyproject.toml, requirements.txt, tsconfig, docker-compose, etc.), README/docs file list, primary languages by loc.
- Hard rule: `.env*`, key files, and anything matching common secret patterns are excluded from all agent context.

### S2. Cartography
- Agent pass over `ingest.json` + README/docs contents + manifest contents.
- Emit `components.json`:

```json
{
  "components": [
    {
      "id": "api",
      "kind": "backend-api",
      "paths": ["apps/api/**"],
      "stack": ["typescript", "express", "postgres"],
      "entrypoints": ["apps/api/src/index.ts"],
      "depends_on": ["shared-lib"],
      "docs": ["apps/api/README.md"],
      "confidence": 0.9,
      "notes": "REST API, ~40 routes, jest tests present"
    }
  ]
}
```

- `kind` enum: `frontend-app`, `backend-api`, `worker`, `data-pipeline`, `shared-lib`, `infra`, `docs`, `other`.

### S3. Role menu
- Deterministic scoring over `components.json` (no agent call needed): for each role archetype, rate `strong` / `good` / `weak` / `none` based on presence, size, and test coverage of in-lane components.
- Emit `roles.json` with ratings + one-line reasons. UI renders these as role cards; CLI prints them. Requesting a `none` role is a hard error with the reason shown.

### S4. Surface selection
- Agent pass scoped to in-lane components for the chosen role. Identify 3–5 candidate surfaces, each scored on: isolation (few cross-component deps), representativeness (looks like daily work), and richness (enough behavior to hide a bug or extend).
- Emit `surfaces.json`; user picks one, or `--auto` picks top score.

### S5. Generation (the core)
- Input: chosen surface, role archetype, task archetype, seniority.
- **Synthesis rule (non-negotiable): the generated repo must not contain source-repo code verbatim.** It mirrors stack, conventions, naming style, and domain flavor, but every file is written fresh. Domain may be lightly fictionalized (same shape, different nouns).
- Stub rule: out-of-lane dependencies are replaced per the role archetype table below. The candidate repo must install and run with **one documented command** and require **no external services** (SQLite or in-memory instead of Postgres, MSW/fixtures instead of live APIs).
- Outputs, written into `package/`:
  - `candidate/` — the starter mini-repo (≈ 10–25 files) incl. `README.md` with setup, task statement, time expectation (2–4 h), and submission instructions.
  - `candidate/BRIEF.md` — the task, written like a real ticket for `extension`, or an incident-style report for `bug-hunt`.
  - `interviewer/rubric.md` — 4–6 weighted dimensions from the role archetype, each with concrete "great / okay / poor" descriptions tied to this task.
  - `interviewer/answer-key.md` — for bug-hunt: the planted bug, why it's realistic, the fix, expected test. For extension: a reference approach sketch. Plus 5–8 debrief questions.
  - `meta.json` — role, seniority, archetype, source surface id, generation timestamps, verification results.

### Role archetype table

| Role | In-lane components | Stub strategy | Rubric dimensions |
|------|-------------------|---------------|-------------------|
| backend | backend-api, worker, shared-lib | No frontend; HTTP test harness + fixtures; SQLite/in-memory DB | API design, error handling, data modeling, test quality, code clarity |
| frontend | frontend-app (+ API contracts) | Backend → MSW mocks / fixture JSON | Component design, state management, edge-case UX, accessibility basics, test quality |
| fullstack | one vertical slice across the seam | External services only | Seam design, end-to-end correctness, API contract quality, test quality |
| data | data-pipeline, worker | Sources → checked-in sample datasets | Transform correctness, idempotency, data validation, performance awareness, test quality |

### Seniority knob
- `junior`: bug-hunt, single surface, bug is findable via failing behavior described in BRIEF.
- `mid`: extension, ticket includes one ambiguity the candidate must resolve and note.
- `senior`: extension + `DESIGN.md` prompt ("how does this change at 10x scale / multi-tenant"), answer key includes design talking points.

### S6. Verification
- In a sandboxed temp dir: run documented install command, then the candidate repo's test command, with timeouts (arch doc has limits).
- Bug-hunt extra check: the planted bug must be *demonstrable* — a verification-only test (kept in `interviewer/`, never shipped in `candidate/`) fails against the starter code and passes against the answer-key fix.
- Run secrets scan (gitleaks) over the whole package.
- On failure: one automatic repair loop (feed errors back to the generator), then fail loudly with logs. Never package an unverified repo.

### S7. Packaging
- Zip `package/` → `quarry-<repo>-<role>-<seniority>-<date>.zip`. CLI prints path; UI offers download.

## Acceptance criteria

1. `quarry generate <url> --role backend --seniority mid --auto` completes end-to-end on the three dogfood repos (mvp.md) in **< 20 min each**. (Was 10; raised after measurement — S5 generation alone is ~14.5 min on a real repo, and the figure had been set against a 16-file fixture. See docs/learnings.md.)
2. Every shipped package passed S6, including the bug-demonstrability check for bug-hunt.
3. `candidate/` installs and runs on a clean machine with one command and no external services.
4. No file in `candidate/` matches any ≥ 8-line block from the source repo (automated check).
5. Role menu correctly reports `none` for absent roles (e.g., frontend on a CLI-only repo) and refuses generation.
6. UI completes the same flow with live stage progress and a download button.
