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
}

export const TASK_ARCHETYPES: Readonly<Record<TaskId, TaskArchetype>> = {
  'bug-hunt': {
    id: 'bug-hunt',
    label: 'Bug hunt',
    briefStyle:
      'An incident report, written the way a support escalation or an on-call handover reads: ' +
      'observed behaviour, what was expected, how to reproduce. It states the symptom and ' +
      'never the cause, never names the file, and never uses the word "bug" as a pointer.',
    answerKeyRequirements:
      'The planted bug: where it is, what it does, and why a competent engineer could ' +
      'plausibly have written it. The fix. The test the candidate should add.',
    requiresBugDemonstration: true,
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
