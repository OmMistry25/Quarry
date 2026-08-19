/** Stage identifiers, in pipeline order. See docs/SPEC.md. */
export const STAGES = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'] as const;

export type Stage = (typeof STAGES)[number];
