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
  verify.test.<ext> the verification-only test (see below)
```

Do not create any other top-level directory. Do not write `meta.json` — that is written for
you.

### candidate/

A small, complete, _runnable_ repository mirroring the surface described above.

- **10–25 files.** Enough to feel like a real project, small enough to read in ten minutes.
- **One command installs it. One command runs its tests.** Both documented in `README.md`,
  both stated in your JSON reply.
- **No external services.** {{STUB_STRATEGY}}
- It must include its own tests, written in the source repo's testing style, which **pass**
  against the starter code.
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

### interviewer/verify.test.<ext>

A single test file that Quarry runs to prove the task is real. It must:

- **Fail** against `candidate/` as shipped.
- **Pass** once the fix described in the answer key is applied.
- Use the same test framework as `candidate/`, and import from `candidate/` by relative path
  as though it were placed inside the candidate project's test directory.

It is never shipped to the candidate. Do not reference it from `candidate/`.

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
  "notes": "anything the reviewer should know"
}
```

`files` lists every file you wrote, relative to your working directory. `setupCommand` and
`testCommand` are run verbatim from inside `candidate/`. `plantedBugFile` is required for a
bug hunt.
