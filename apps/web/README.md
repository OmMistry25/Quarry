# Quarry demo UI

Single page: paste a repository, pick a role, watch the pipeline run, download the package.
Demo only — no auth, no persistence beyond `work/`, one run at a time.

## Running it

```
pnpm install
pnpm --filter core build     # the UI loads core at runtime, so it must be built
pnpm --filter web dev        # http://localhost:3000
```

`claude` and `gitleaks` must be on PATH, exactly as for the CLI.

Run directories are read from and written to the repo's `work/`, found two levels up from
`apps/web`. Set `QUARRY_WORK_DIR` if the server is started from somewhere else.

## Shape

| Route                       | Does                                                                         |
| --------------------------- | ---------------------------------------------------------------------------- |
| `POST /api/map`             | S1 → S3, streams stage events, ends with the role menu and a run id          |
| `POST /api/generate`        | S4 → S7 for a role, streams stage and verification events, ends with the zip |
| `GET /api/download/<runId>` | serves that run's package                                                    |

Both POSTs answer with `text/event-stream`. The page frames the events itself rather than
using `EventSource`, which can only issue GETs — putting a repo URL and role into a query
string to satisfy it would have been worse.

## Two things worth knowing before changing this

**`core` is loaded with a runtime `import()`, not bundled.** It locates prompt templates with
`new URL('../../../../prompts/', import.meta.url)`, which webpack rewrites into something it
cannot resolve, and it is ESM-only, so declaring it a CommonJS external makes the server
`require()` a package whose exports map has no `require` condition. The dynamic import in
`lib/core.ts` is marked `webpackIgnore`, so Node resolves it from `node_modules` exactly as
the CLI does.

**Generation takes 8–12 minutes.** That is S5 writing a whole repository, then S6 installing
it, running its tests, and checking it against the source. The progress stream is the feature
that makes the wait legible, not decoration around it.
