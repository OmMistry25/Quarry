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

## Fullstack surfaces span the seam

**This section applies only when the role is `fullstack`. Skip it otherwise.**

Fullstack is assessed on a **vertical slice**: one workflow followed across the boundary
between the UI and the code serving it. A surface naming a single component is not a
fullstack surface, however good it is on its own — a candidate handed one would be doing a
backend task or a frontend task with the wrong label on it.

So every surface you return must name two components: `componentId` for the side the workflow
starts on, and `seamComponentId` for the other side. `paths` must contain the files on **both**
sides — the component that renders the screen and the endpoint or handler it calls, or the
client that submits a form and the validation that rejects it.

Score **isolation for the pair as a unit**: how cleanly the two sides lift out _together_,
away from the rest of the repo. Do not mark a surface down for the dependency that connects
them — that dependency is the thing being assessed. A pair that needs only each other and a
database scores high; a pair that also drags in three sibling services scores low.

Pick the seam where the contract is most visible: a request shape with validation on both
sides, an error the server returns and the client has to render, a state the two must agree
on. "The page calls an endpoint" is not enough on its own.

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
- `seamComponentId` — **fullstack only**: the component on the other side of the seam. Omit
  it for every other role.
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
