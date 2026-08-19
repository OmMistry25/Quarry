# S4 — Surface selection

Find **3 to 5 assessable surfaces** in the code below, for the role named at the top of the
context.

A **surface** is a self-contained workflow someone in this role would actually work on: an
API route with its service and its tests, a background sync job, a data transform, a
validation layer. It is the unit a take-home task gets built from — a candidate will receive
a fresh mini-repo that mirrors one of these, and will be asked either to find a planted bug
in it or to extend it.

## What makes a good surface

Judge each candidate on three things, and score each 0 to 1.

**Isolation** — how cleanly it lifts out of the repo.

- `0.9+`: touches one component, depends on nothing but its own module and the standard
  library or a database driver.
- `0.5`: pulls in one or two siblings that would need stubbing.
- `0.2`: entangled with several components, external services, or shared global state.

This is the criterion weighted most heavily, because the generated repo must install and run
with **one command and no external services**. A fascinating workflow that needs Kafka and
three sibling packages is worth less than a dull one that does not.

**Representativeness** — does it look like this team's daily work?

- High: uses the repo's own conventions, sits in the middle of a normal feature path, and a
  reviewer would recognise it as "yes, that is what we do here".
- Low: generated code, a one-off migration, a thin wrapper, framework boilerplate, a
  `index.ts` that only re-exports.

**Richness** — is there enough behaviour to build a task around?

- High: several branches, edge cases, error paths, validation, ordering or state that can be
  got subtly wrong. Existing tests are a strong positive signal.
- Low: a pure function of five lines, a constants file, a type-only module.

A surface needs somewhere for a bug to hide. "It reads a row and returns it" is not rich.
"It applies a signed delta and must reject anything that would take stock below zero" is.

## Rules

- Every surface must sit inside one of the in-lane components listed in the context, and
  `componentId` must be exactly that component's id.
- Every path in `paths` must be a path that appears in the context. Do not invent files.
- Prefer surfaces that already have tests. Say so in the rationale when they do.
- Do not propose the same workflow twice under different names.
- If the code genuinely only supports three surfaces, return three. Do not pad to five with
  weak candidates.

## Field guide

- `id` — short lowercase slug, unique: `stock-adjustment`, `shipment-recording`.
- `title` — a human phrase: "Stock adjustment with non-negative invariant".
- `componentId` — the in-lane component it belongs to.
- `paths` — the files that make up the surface, most important first.
- `summary` — two or three sentences on what the workflow does.
- `scores` — `isolation`, `representativeness`, `richness`, each 0 to 1.
- `rationale` — why those scores. Name the specific dependencies, conventions or edge cases
  you are reacting to. A reviewer reads this to decide whether to trust the ranking.
- `assessmentIdea` — one concrete behaviour a bug could be planted in, or one concrete
  extension a candidate could be asked to build. Be specific about the behaviour, not the
  file.

## Output contract

Reply with a single JSON object, nothing else. No prose, no markdown fence.

```
{
  "surfaces": [
    {
      "id": "stock-adjustment",
      "title": "Stock adjustment with non-negative invariant",
      "componentId": "api",
      "paths": ["src/services/inventory.ts", "src/routes/items.ts", "test/inventory.spec.ts"],
      "summary": "Applies a signed delta to an item's stock level. Rejects adjustments that would take the quantity below zero, and returns the updated item.",
      "scores": { "isolation": 0.9, "representativeness": 0.8, "richness": 0.7 },
      "rationale": "Depends only on the db layer and its own service; no cross-component calls. Sits on the main feature path and already has tests covering the negative case.",
      "assessmentIdea": "Plant an off-by-one in the boundary check so an adjustment landing exactly on zero is rejected."
    }
  ]
}
```

Between 3 and 5 surfaces. Every `id` unique.

---

{{CONTEXT}}
