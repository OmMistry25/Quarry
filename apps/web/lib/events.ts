/**
 * The event vocabulary the API routes stream and the page renders.
 *
 * One shared type rather than two: the browser and the route handler are the same repo, and
 * a progress stream whose shape drifts between the two ends is a silent failure — the page
 * would render nothing while the pipeline ran perfectly.
 */

export interface StageEvent {
  kind: 'stage';
  /** S1…S7, as the CLI prints them. */
  stage: string;
  message: string;
}

export interface StepEvent {
  kind: 'step';
  name: string;
  ok: boolean;
  detail: string;
}

/** A substitution the user has to see — the frontend/junior fallback, today. */
export interface NoticeEvent {
  kind: 'notice';
  message: string;
}

export interface RolesEvent {
  kind: 'roles';
  runId: string;
  roles: {
    role: string;
    label: string;
    rating: string;
    reason: string;
  }[];
}

export interface DoneEvent {
  kind: 'done';
  runId: string;
  /** Basename of the zip, downloaded from /api/download/<runId>. */
  zip: string;
  bytes: number;
  role: string;
  seniority: string;
  task: string;
  surfaceTitle: string;
  costUsd?: number;
  repairs: number;
}

export interface ErrorEvent {
  kind: 'error';
  message: string;
}

export type QuarryEvent =
  StageEvent | StepEvent | NoticeEvent | RolesEvent | DoneEvent | ErrorEvent;
