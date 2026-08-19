import { ROLE_ARCHETYPES, ROLE_IDS, type RoleArchetype, type RoleId } from '../archetypes/roles.js';
import type { ComponentKind } from '../schemas/components.js';
import {
  componentMatcher,
  filesForComponent,
  isAssessableLanguage,
  isTestPath,
} from '../components/match.js';
import { QuarryError } from '../errors.js';
import type { Components } from '../schemas/components.js';
import type { Ingest, TreeEntry } from '../schemas/ingest.js';
import { Roles, ROLES_SCHEMA_VERSION, type RoleCard, type RoleEvidence } from '../schemas/roles.js';
import { writeArtifact, type RunDir } from '../run.js';

/**
 * S3 — Role menu (docs/SPEC.md).
 *
 * Deterministic scoring over `components.json`; no agent call, so the same inputs always
 * produce the same menu and the thresholds below are the whole of the behaviour.
 */

/** Below this there is not enough in-lane code to build a task from. */
const MINIMUM_ASSESSABLE_LOC = 150;

const STRONG_SCORE = 70;
const GOOD_SCORE = 45;

export interface RoleMenuOptions {
  run: RunDir;
  ingest: Ingest;
  components: Components;
  now?: Date;
}

export interface RoleMenuResult {
  roles: Roles;
  artifactPath: string;
}

export async function roleMenu(options: RoleMenuOptions): Promise<RoleMenuResult> {
  const cards = ROLE_IDS.map((id) =>
    scoreRole(ROLE_ARCHETYPES[id], options.components, options.ingest),
  );

  const artifact = Roles.parse({
    schemaVersion: ROLES_SCHEMA_VERSION,
    runId: options.run.runId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    roles: cards,
  });

  const artifactPath = await writeArtifact(options.run, 'roles.json', artifact);
  return { roles: artifact, artifactPath };
}

/**
 * Rate one role from the size, test coverage, breadth and documentation of its in-lane
 * components.
 */
export function scoreRole(
  archetype: RoleArchetype,
  components: Components,
  ingest: Ingest,
): RoleCard {
  const inLane = components.components.filter((component) =>
    archetype.inLaneKinds.includes(component.kind),
  );

  const evidence = measure(inLane, components.components, ingest);

  // Fullstack is a slice *across* a seam, so one side alone does not qualify.
  if (archetype.id === 'fullstack') {
    const kinds = new Set(inLane.map((component) => component.kind));
    if (!kinds.has('frontend-app') || !kinds.has('backend-api')) {
      return card(archetype, 'none', `${archetype.absentHint}.`, evidence);
    }
  }

  if (inLane.length === 0) {
    return card(archetype, 'none', `${archetype.absentHint}.`, evidence);
  }

  // The pnpm/pnpm case: in-lane components exist and are substantial, but in a language
  // Quarry cannot generate a take-home for. That is "none", not "weak" — and the reason has
  // to say which language, or the verdict looks like a bug.
  if (evidence.assessableLoc < MINIMUM_ASSESSABLE_LOC) {
    if (evidence.unassessableLoc > evidence.assessableLoc) {
      const dominant = dominantUnassessableLanguage(inLane, ingest);
      return card(
        archetype,
        'none',
        `in-lane components are mostly ${dominant}, which Quarry does not assess ` +
          '(TypeScript, JavaScript and Python only).',
        evidence,
      );
    }

    return card(
      archetype,
      'none',
      `only ${evidence.assessableLoc} lines of assessable code in-lane — too little to build a task from.`,
      evidence,
    );
  }

  const rating =
    evidence.score >= STRONG_SCORE ? 'strong' : evidence.score >= GOOD_SCORE ? 'good' : 'weak';

  return card(archetype, rating, describe(evidence, inLane.length), evidence);
}

/**
 * Component kinds that belong to some role's lane. Everything else — `other`, `docs`,
 * `infra` — is neutral: it competes with no role, so its contents can be attributed to
 * whichever role they actually exercise.
 */
const CLAIMED_KINDS: ReadonlySet<ComponentKind> = new Set(
  ROLE_IDS.flatMap((id) => [...ROLE_ARCHETYPES[id].inLaneKinds]),
);

/**
 * Tests very often live *outside* the component they exercise: a top-level `test/` beside
 * `lib/`, which is the standard layout in Python and common in JS. `expressjs/express` is
 * the case that caught this — S2 correctly mapped its 13,501 lines of tests as a separate
 * `other` component, and counting only in-lane files reported "no tests found" for a repo
 * with one of the better test suites in the ecosystem.
 *
 * So a test file also counts toward a role when it sits in a *neutral* component (or in no
 * component at all). Tests inside another role's lane — a frontend app's suite, when scoring
 * backend — still do not.
 */
function collectNeutralTestFiles(
  inLane: Components['components'],
  all: Components['components'],
  ingest: Ingest,
): TreeEntry[] {
  const claimedMatchers = all
    .filter((component) => CLAIMED_KINDS.has(component.kind) && !inLane.includes(component))
    .map((component) => componentMatcher(component.paths));

  return ingest.tree.filter((file) => {
    if (!isTestPath(file.path)) return false;
    if (!isAssessableLanguage(file.lang)) return false;
    return !claimedMatchers.some((matches) => matches(file.path));
  });
}

function measure(
  inLane: Components['components'],
  all: Components['components'],
  ingest: Ingest,
): RoleEvidence {
  let assessableLoc = 0;
  let unassessableLoc = 0;
  let testLoc = 0;
  let docCount = 0;
  const seen = new Set<string>();

  const countFile = (file: TreeEntry): void => {
    // Components may overlap; a file must not be counted twice.
    if (seen.has(file.path)) return;
    seen.add(file.path);

    const loc = file.loc ?? 0;
    if (!isAssessableLanguage(file.lang)) {
      unassessableLoc += loc;
      return;
    }

    assessableLoc += loc;
    if (isTestPath(file.path)) testLoc += loc;
  };

  for (const component of inLane) {
    docCount += component.docs.length;
    for (const file of filesForComponent(component, ingest.tree)) countFile(file);
  }

  if (inLane.length > 0) {
    for (const file of collectNeutralTestFiles(inLane, all, ingest)) countFile(file);
  }

  const score = computeScore({
    assessableLoc,
    testLoc,
    componentCount: inLane.length,
    docCount,
  });

  return {
    componentIds: inLane.map((component) => component.id),
    assessableLoc,
    unassessableLoc,
    testLoc,
    fileCount: seen.size,
    docCount,
    score,
  };
}

/**
 * 0–100, from four signals SPEC names or implies: size, test coverage, breadth, docs.
 *
 * The weights are a judgement call rather than a derivation — what they encode is that a
 * repo with tests is far more assessable than one without, because a bug-hunt task needs
 * somewhere for a candidate's test to live.
 */
export function computeScore(input: {
  assessableLoc: number;
  testLoc: number;
  componentCount: number;
  docCount: number;
}): number {
  let score = 0;

  // Size, 0–40.
  if (input.assessableLoc >= 3_000) score += 40;
  else if (input.assessableLoc >= 1_000) score += 32;
  else if (input.assessableLoc >= 400) score += 22;
  else score += 12;

  // Test coverage, 0–35. The single strongest signal.
  const testRatio = input.assessableLoc > 0 ? input.testLoc / input.assessableLoc : 0;
  if (testRatio >= 0.25) score += 35;
  else if (testRatio >= 0.12) score += 28;
  else if (testRatio >= 0.04) score += 18;
  else if (input.testLoc > 0) score += 8;

  // Breadth, 0–15. More than one in-lane component means more candidate surfaces.
  if (input.componentCount >= 3) score += 15;
  else if (input.componentCount === 2) score += 10;
  else score += 5;

  // Documentation, 0–10. Docs make a generated brief sound like the real team wrote it.
  if (input.docCount >= 3) score += 10;
  else if (input.docCount >= 1) score += 6;

  return Math.min(100, score);
}

function describe(evidence: RoleEvidence, componentCount: number): string {
  const parts = [
    `${componentCount} in-lane component${componentCount === 1 ? '' : 's'}`,
    `${evidence.assessableLoc.toLocaleString('en-US')} assessable loc`,
  ];

  parts.push(
    evidence.testLoc > 0
      ? `${Math.round((evidence.testLoc / evidence.assessableLoc) * 100)}% of it tests`
      : 'no tests found',
  );

  return `${parts.join(', ')}.`;
}

function dominantUnassessableLanguage(inLane: Components['components'], ingest: Ingest): string {
  const totals = new Map<string, number>();

  for (const component of inLane) {
    for (const file of filesForComponent(component, ingest.tree)) {
      if (isAssessableLanguage(file.lang) || file.lang === undefined) continue;
      totals.set(file.lang, (totals.get(file.lang) ?? 0) + (file.loc ?? 0));
    }
  }

  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? 'an unsupported language';
}

function card(
  archetype: RoleArchetype,
  rating: RoleCard['rating'],
  reason: string,
  evidence: RoleEvidence,
): RoleCard {
  return { role: archetype.id, label: archetype.label, rating, reason, evidence };
}

/**
 * SPEC: "Requesting a `none` role is a hard error with the reason shown." Enforced here so
 * every caller — CLI and UI alike — fails the same way.
 */
export function assertRoleSupported(roles: Roles, role: RoleId): RoleCard {
  const card = roles.roles.find((entry) => entry.role === role);

  if (card === undefined) {
    throw new QuarryError(`Unknown role "${role}".`, { stage: 's3' });
  }

  if (card.rating === 'none') {
    const supported = roles.roles
      .filter((entry) => entry.rating !== 'none')
      .map((entry) => `${entry.role} (${entry.rating})`);

    throw new QuarryError(
      `This repository does not support the ${card.label} role: ${card.reason} ` +
        (supported.length > 0
          ? `Supported roles: ${supported.join(', ')}.`
          : 'No role is supported for this repository.'),
      { stage: 's3' },
    );
  }

  return card;
}

export type { TreeEntry };
