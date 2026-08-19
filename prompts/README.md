# prompts/

One markdown prompt template per agent stage. **Treated as code**: versioned, reviewed, and
never inlined as string literals in TypeScript (`CLAUDE.md`).

Each template states its JSON contract explicitly; the contract is then enforced with a zod
schema from `packages/core/src/schemas/` on the way back — agents drift, so we parse rather
than trust.

Planned:

| File                | Stage                                                  | Phase |
| ------------------- | ------------------------------------------------------ | ----- |
| `s2-cartography.md` | Partition the repo into components                     | 2     |
| `s4-surfaces.md`    | Find 3–5 assessable surfaces for a role                | 3     |
| `s5-generate.md`    | Write the candidate repo, brief, rubric and answer key | 4     |
