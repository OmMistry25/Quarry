# apps/web — placeholder

Intentionally empty until **Phase 8** of `docs/tasks-mvp.md`.

Quarry is CLI-first (`docs/context.md` decision 7); the UI is a demo veneer and gets built
only once the pipeline works end-to-end. Adding Next.js now would slow every `pnpm install`
for nine phases of work that never touch it.

Phase 8 turns this into a single-page Next.js 14 app: URL input → role cards from
`roles.json` → seniority picker → SSE stage progress → download button.
