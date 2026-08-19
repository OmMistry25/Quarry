# S2 — Cartography

Partition a repository into **components**: coherent sub-parts that a team would talk about
as separate things ("the API", "the web app", "the ETL job", "the shared types package").

You are given a curated view of the repository: a directory map, the contents of its
manifests, and its documentation. You do **not** have the source files, and you do not need
them — manifests and prose identify components far more reliably than reading code does.

## What counts as a component

A component is something with its own reason to exist. Good signals, roughly in order of
strength:

1. **Its own manifest.** A `package.json`, `pyproject.toml` or `go.mod` in a subdirectory is
   the single clearest boundary in a repo.
2. **A workspace declaration.** `workspaces`, `pnpm-workspace.yaml`, a `packages/*` layout.
3. **A documented boundary.** The README describes "the worker" or "the dashboard".
4. **A directory whose name and contents are unambiguous** — `src/api/`, `etl/`, `infra/`.

### Processes that share a package are still separate components

One manifest does not always mean one component. When the repo's own deployment description —
`compose.yaml` services, a `Procfile`, Kubernetes manifests, CI jobs, or the README — runs the
same package as several long-lived processes (a web server, a queue worker, a scheduler, a
consumer), each of those is its own component. They are deployed, scaled, and broken
independently, which is what makes them separate things a team talks about.

Split on that evidence, and only when the process has a directory of its own to point at:

- a `tasks/` or `jobs/` directory run by a queue worker → a `worker` component, even though the
  package around it has a single `pyproject.toml`
- an `etl/`, `pipelines/` or `transforms/` directory run on a schedule → a `data-pipeline`

Give the carved-out component its own paths, and exclude them from the parent with a negation
so the two do not overlap:

```
{"id": "api",    "paths": ["myapp/**", "!myapp/tasks/**"]}
{"id": "worker", "paths": ["myapp/tasks/**"]}
```

Do not invent processes the repo does not run. A `tasks.py` imported and called by the web
process is a layer, not a component.

Merge rather than split when unsure. A repo with one `package.json`, one `src/` and no
workspace config is usually **one** component, not one per subdirectory. Splitting a small
app into "routes", "services" and "models" is wrong: those are layers inside a component, not
components.

Most repositories have between 1 and 8 components. If you find yourself listing more than
about 12, you are almost certainly describing directories rather than components.

## Field guide

- `id` — a short lowercase slug, unique in the reply: `api`, `web`, `worker`, `shared-types`.
- `kind` — exactly one of:
  - `frontend-app` — a browser UI (React/Vue/Svelte app, Next.js site)
  - `backend-api` — serves HTTP/RPC requests
  - `worker` — background jobs, queue consumers, schedulers, CLIs that run as processes
  - `data-pipeline` — ETL, batch transforms, analytics jobs, notebooks
  - `shared-lib` — imported by other components, ships no process of its own
  - `infra` — Terraform, Kubernetes, Docker composition, CI/CD
  - `docs` — documentation sites and standalone docs packages
  - `other` — genuinely none of the above
- `paths` — glob patterns scoping the component, e.g. `["apps/api/**"]`. For a single-component
  repo use `["**"]`. Must match paths that actually appear in the directory map.
- `stack` — lowercase technology tags drawn from the manifests: `["typescript", "express",
"postgres"]`. Name what the dependencies show, not what you assume.
- `entrypoints` — files where execution begins: a server bootstrap, a CLI entry, a Next.js
  `app/` root. Use paths consistent with the directory map. An empty list is acceptable for a
  library.
- `depends_on` — ids of **other components in this same reply**. Never invent an id, never
  list a package from npm, never list a component's own id. Most components depend on nothing.
- `docs` — documentation paths that describe this component specifically.
- `confidence` — 0 to 1. Be honest: 0.9 when a manifest and docs agree, 0.4 when you are
  inferring from a directory name alone.
- `notes` — one or two sentences a human reviewer would find useful: size, test framework,
  anything surprising. Not a restatement of the other fields.

## Output contract

Reply with a single JSON object, nothing else. No prose, no markdown fence.

```
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

`components` must contain at least one entry. Every `depends_on` value must be the `id` of
another component in the same reply.

---

{{CONTEXT}}
