/**
 * Task and seniority archetypes (docs/SPEC.md).
 *
 * Seniority is a scope knob, not a separate system (docs/context.md decision 5): it selects
 * the task archetype and how much room the candidate is given, rather than branching the
 * pipeline.
 */

export const TASK_IDS = ['bug-hunt', 'extension'] as const;
export type TaskId = (typeof TASK_IDS)[number];

export const SENIORITY_IDS = ['junior', 'mid', 'senior'] as const;
export type SeniorityId = (typeof SENIORITY_IDS)[number];

export interface TaskArchetype {
  id: TaskId;
  label: string;
  /** How BRIEF.md is written. Goes into the S5 prompt. */
  briefStyle: string;
  /** What interviewer/answer-key.md must contain for this archetype. */
  answerKeyRequirements: string;
  /** Whether S6 needs a verification-only test that fails on the starter. */
  requiresBugDemonstration: boolean;
  /** Archetype-specific instructions on constructing the task itself. Empty for extension. */
  plantingGuidance?: string;
  /** Extra `interviewer/` entries, rendered into the package layout in the S5 prompt. */
  interviewerExtras: readonly string[];
  /** Archetype-specific prompt sections, appended after the shared ones. */
  promptSections: string;
}

export const TASK_ARCHETYPES: Readonly<Record<TaskId, TaskArchetype>> = {
  'bug-hunt': {
    id: 'bug-hunt',
    label: 'Bug hunt',
    briefStyle:
      'An incident report, written the way a support escalation or an on-call handover reads: ' +
      'observed behaviour, what was expected, how to reproduce. It states the symptom and ' +
      'never the cause, never names the file, and never uses the word "bug" as a pointer.',
    /**
     * Written after watching two of three generations plant a bug their own shipped tests
     * caught. The generator writes a thorough suite for the behaviour it just built, then
     * breaks some of that behaviour — and the two collide. Telling it the rule is not enough;
     * it needs the order of operations and a check it can actually perform.
     */
    plantingGuidance: `## Planting the bug

Do this **last**, and in this order:

1. Write \`candidate/\` correct and complete, with its tests, and satisfy yourself the suite
   would pass.
2. Re-read your own test files and list what they actually assert.
3. Only then plant the bug — in a behaviour **none of those assertions cover**.

The shipped suite must pass against the planted bug. This is checked mechanically and it is
the single most common reason a package is rejected: if \`npm test\` fails out of the box, the
candidate finds the bug in one command and there is no hunt.

That does not mean writing a thin suite. Write the tests a competent team would, then choose
somewhere they do not reach: an edge case one step beyond what is asserted, an ordering that
only matters for input the tests do not use, a boundary the suite approaches but never lands
on. If your tests check a 3-unit and a 5-unit adjustment, the exact-zero case is still open.

Before you finish, name to yourself the test that would have caught your bug. If one exists,
you have planted it in the wrong place.`,
    answerKeyRequirements:
      'The planted bug: where it is, what it does, and why a competent engineer could ' +
      'plausibly have written it. The fix. The test the candidate should add.',
    requiresBugDemonstration: true,
    interviewerExtras: [
      '  <verify test>     the verification-only test — see below for the name',
      '  fix/              the corrected version of every file the fix touches',
    ],
    promptSections: `### The verification test

A single test file in \`interviewer/\`, named so the project's own runner would collect it:
**\`verify.test.<ext>\`** for JavaScript or TypeScript, **\`test_verify.py\`** for Python. Do not
write \`verify.test.py\` — pytest does not collect that.

Quarry runs it to prove the task is real. It must:

- **Fail** against \`candidate/\` as shipped.
- **Pass** once the fix described in the answer key is applied.
- Use the same test framework as \`candidate/\`, and import from \`candidate/\` by relative path
  as though it were placed inside the candidate project's test directory.

It is never shipped to the candidate. Do not reference it from \`candidate/\`.

### interviewer/fix/

The answer key describes the fix in prose. This directory contains it as **code**, so the fix
can be applied mechanically.

For every file the fix changes, write the **complete corrected file** at the same path it has
inside \`candidate/\`, but under \`interviewer/fix/\`. If the bug is in
\`candidate/src/services/booking.ts\`, write \`interviewer/fix/src/services/booking.ts\`
containing that whole file exactly as it should read once fixed.

Quarry copies \`candidate/\`, overlays these files on top, and runs the verification test against
the result. That test must fail before the overlay and pass after it, so these files must be
the real fix and nothing else — do not also tidy unrelated code here.

Usually this is one file.
`,
  },
  extension: {
    id: 'extension',
    label: 'Extension',
    briefStyle:
      'A ticket, written the way the team would file one: context, the change wanted, ' +
      'acceptance criteria.',
    answerKeyRequirements:
      'A reference approach sketch — the shape of a good solution, the decisions worth ' +
      'making, and what a strong candidate does that a weak one does not.',
    requiresBugDemonstration: false,
    interviewerExtras: [],
    promptSections: `### There is no planted bug

This is an extension, not a bug hunt. \`candidate/\` must be **correct** as shipped: its own
tests pass, and nothing is deliberately broken. Do not write a verification test or a fix
directory.

What makes this hard is the work itself, so the starter has to leave a real gap:

- The feature genuinely does not exist yet. Do not stub it and ask the candidate to fill in a
  function body — that is a puzzle, not a ticket.
- The surrounding code must show clearly how a feature of this kind is built here: where
  validation lives, how errors surface, how tests are written. The candidate should be able to
  follow the existing grain rather than guess at it.
- The change should touch two or three files, the way a real ticket does. A single-file change
  is too small to reveal anything about how someone works.
`,
  },
};

export interface SeniorityArchetype {
  id: SeniorityId;
  task: TaskId;
  /** Extra scope beyond the base task, phrased for the S5 prompt. Empty for junior. */
  extraScope: string;
  /** Whether candidate/DESIGN.md is required. */
  requiresDesignNote: boolean;
}

/** SPEC's seniority knob: junior = bug hunt, mid = extension, senior = extension + design. */
export const SENIORITY_ARCHETYPES: Readonly<Record<SeniorityId, SeniorityArchetype>> = {
  junior: {
    id: 'junior',
    task: 'bug-hunt',
    extraScope: '',
    requiresDesignNote: false,
  },
  mid: {
    id: 'mid',
    task: 'extension',
    extraScope:
      'The ticket contains exactly one genuine ambiguity the candidate has to resolve and ' +
      'note. It must be a real product question, not a missing detail.',
    requiresDesignNote: false,
  },
  senior: {
    id: 'senior',
    task: 'extension',
    extraScope:
      'The ticket contains one genuine ambiguity, and the candidate is also asked for a ' +
      'DESIGN.md answering how the change holds up at 10x scale or multi-tenant.',
    requiresDesignNote: true,
  },
};

export function taskForSeniority(seniority: SeniorityId): TaskArchetype {
  return TASK_ARCHETYPES[SENIORITY_ARCHETYPES[seniority].task];
}
