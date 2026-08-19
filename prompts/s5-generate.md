# S5 — Generate the take-home package

You are writing a complete take-home assessment package into your current working directory.
It will be sent to a real engineering candidate by a real hiring team, so it has to be
something a senior engineer would be willing to put their name on.

## The one rule that cannot be bent

**Write every file fresh. Copy nothing.**

The reference material below is the source repository. You are reading it to learn how this
team writes code — their stack, their layering, their naming, their error handling, their
test style, the shape of their domain. You are **not** extracting from it.

Concretely:

- No file you write may reproduce any run of 8 or more lines from the reference material.
  This is checked automatically and a match fails the whole run.
- Change the domain nouns. If the source tracks _warehouse inventory_, write something with
  the same shape about _studio equipment_ or _lab samples_ — same relationships, same
  operations, different subject. Keep the _shape_, discard the _subject_.
- Identifier names, comments and strings must be your own. Mirroring `adjustStock` as
  `adjustQuantity` is fine; copying a comment verbatim is not.
- Configuration counts. Write your own `package.json`, `tsconfig.json` and test config rather
  than reproducing theirs. Same tools and versions, your own file.

The pitch for this product is "your codebase, zero IP exposure". A single copied block breaks
that. When in doubt, write it differently.

**Where this actually goes wrong is framework boilerplate.** Not the interesting logic — you
rewrite that naturally — but the stereotyped glue around it: form submit handlers, router
setup, error middleware, test harness scaffolding, provider wrappers. Idiomatic code
converges, so when you reach for the obvious shape you often reproduce the reference exactly.
A real violation caught in testing looked like this:

```
const handleFormSubmit = form.handleSubmit(async (data) => {
  try {
    await onFormSubmit(data);
  } catch {
    return;
  }
  form.reset(form.getValues());
```

Nothing there is wrong, and every line is idiomatic — which is the trap. When you write the
stereotyped part, deliberately make a different choice: name the callback something else,
handle the error rather than swallowing it, reorder independent statements, extract or inline
where the source did the opposite. Same behaviour, your own hand.

## What you are building

{{TASK_BRIEF}}

## The package layout

Create exactly this structure in your working directory:

```
candidate/          the starter repo the candidate receives
  README.md         setup, the task, time expectation, how to submit
  BRIEF.md          the task itself
  <source files>    10-25 files total across candidate/
interviewer/        never sent to the candidate
  rubric.md
  answer-key.md
{{INTERVIEWER_EXTRAS}}
```

Do not create any other top-level directory. Do not write `meta.json` — that is written for
you.

### candidate/

A small, complete, _runnable_ repository mirroring the surface described above.

- **10–25 files.** Enough to feel like a real project, small enough to read in ten minutes.
- **One command installs it. One command runs its tests.** Both documented in `README.md`,
  both stated in your JSON reply.
- **Use the same test runner the source repo uses.** If it runs mocha, use mocha; jest, use
  jest; vitest, pytest, the same. Its `package.json` or `pyproject.toml` is in the reference
  material — read the actual script and mirror its form. Do not substitute a runner you
  happen to prefer: matching the team's tooling is part of mirroring their conventions, and
  an unfamiliar runner makes the starter feel less like their codebase.
- **Your commands are run verbatim and they are the first thing checked.** You cannot execute
  them yourself, so write only invocations you are certain of. Two specifics that have
  actually broken runs:
  - Prefer an explicit file glob to a bare directory. `node --test 'test/**/*.test.js'`
    works; `node --test test/` is rejected outright on current Node versions.
  - The test command must also work when a single test file path is appended to it, because
    that is how the planted bug gets verified.
- **No external services.** {{STUB_STRATEGY}}
- It must include its own tests, written in the source repo's testing style, which **pass**
  against the starter code. This is checked by running them, and it is the most common reason
  a package is rejected.

  **You cannot run these tests, so assert only what you are certain of.** Every failure so
  far has been the same shape: a suite describing what the author _meant_ the code to do,
  against an implementation that does something slightly different. A UI test asserting an
  element is absent, a hint that appears under a condition you did not quite implement, a
  disabled state you described but did not wire.

  Prefer few, simple, obviously-true assertions over a comprehensive suite you are guessing
  at. Before you finish, read each test beside the code it exercises and satisfy yourself the
  assertion follows from what you actually wrote — not from what you were aiming for. A
  smaller suite that passes is worth far more here than a thorough one that does not.

- Include whatever config the stack genuinely needs and nothing more.

`candidate/README.md` covers: what the project is, the one-command setup, how to run tests,
where the task is written down (`BRIEF.md`), a time expectation of **2–4 hours**, and how to
submit. Nothing about how it was generated, and no mention of Quarry.

### candidate/BRIEF.md

{{BRIEF_STYLE}}

Write it as the team would. No meta-commentary, no "your task is to demonstrate", no rubric
leakage — the candidate must not be able to reverse-engineer the grading criteria from the
brief.

### interviewer/rubric.md

One section per dimension, using exactly these dimensions:

{{RUBRIC_DIMENSIONS}}

Give each a weight (the weights must sum to 100) and three concrete descriptions — **great**,
**okay**, **poor** — written about _this specific task_. "Great: writes clean code" is
useless. "Great: the added test fails on the original code and passes after the fix, and
covers the boundary at exactly zero" is what a reviewer can actually grade against.

### interviewer/answer-key.md

{{ANSWER_KEY_REQUIREMENTS}}

Then **5–8 debrief questions** to ask in a follow-up conversation — the kind that separate
someone who understood the change from someone who pattern-matched their way to it.

{{TASK_SPECIFIC_SECTIONS}}

## Reference material — read for style, copy nothing

{{REFERENCE_MATERIAL}}

## When you are done

Reply with a single JSON object and nothing else:

```
{
  "files": ["candidate/README.md", "candidate/BRIEF.md", "candidate/package.json", "…"],
  "setupCommand": "npm install",
  "testCommand": "npm test",
  "plantedBugFile": "candidate/src/services/booking.ts",
  "fixFiles": ["interviewer/fix/src/services/booking.ts"],
  "notes": "anything the reviewer should know"
}
```

`files` lists every file you wrote, relative to your working directory. `setupCommand` and
`testCommand` are run verbatim from inside `candidate/`. `plantedBugFile` and `fixFiles` are
required for a bug hunt and omitted for an extension.
