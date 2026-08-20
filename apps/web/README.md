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

## Deploying it (Railway)

Cloud deploy is on the out-of-scope list in `docs/mvp.md`; this exists because it was asked
for explicitly. It is a container, not a serverless target, and that is not a preference:

- the pipeline shells out to `claude`, `gitleaks`, `git` and the generated package's own
  toolchain, none of which exist in a serverless runtime;
- `/api/map` writes `work/<runId>/` and `/api/generate` reads it back, so the two calls need
  the same disk;
- one generate call holds an HTTP connection for 8-12 minutes.

```
railway up                     # or point Railway at the repo; it reads railway.json
```

Then, in the Railway service:

| Setting             | Value                                                            |
| ------------------- | ---------------------------------------------------------------- |
| Volume              | mounted at `/data` (the image sets `QUARRY_WORK_DIR=/data/work`) |
| `ANTHROPIC_API_KEY` | your key                                                         |
| `QUARRY_PASSWORD`   | any string — the app refuses to serve without it                 |

`GET /api/health` is the healthcheck: it reports whether `claude`, `gitleaks` and `git` are
present and the volume is writable, and returns 503 if not. A container that boots without
them serves a page that looks fine and then fails several minutes into a run, having already
spent money.

### The password is not optional

S6 installs and runs code an agent wrote moments earlier, from a repository whoever loads the
page typed in. On a laptop that is fine. On a public URL it is a stranger spending your API
credits to run arbitrary code on your container, so an unset `QUARRY_PASSWORD` fails closed in
production rather than serving an open endpoint.

### Sizing

A verification run clones the source repo and installs the generated package's dependencies.
documenso is 2,605 files; give the volume a few GB rather than the minimum, and expect the
container to want ~1 GB of RAM while `npm install` runs.
