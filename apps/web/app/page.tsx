'use client';

import { useEffect, useRef, useState } from 'react';

import type { DoneEvent, QuarryEvent, RolesEvent } from '@/lib/events';
import { parseEvents } from '@/lib/sse';

type Phase = 'idle' | 'mapping' | 'choosing' | 'generating' | 'done';

interface Line {
  text: string;
  tone: 'plain' | 'ok' | 'fail' | 'notice';
}

const SENIORITIES = ['junior', 'mid', 'senior'] as const;

/** A role is offered only when the repo can support it — SPEC acceptance 5. */
const isOffered = (rating: string): boolean => rating !== 'none';

export default function Page() {
  const [repo, setRepo] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [lines, setLines] = useState<Line[]>([]);
  const [roles, setRoles] = useState<RolesEvent['roles']>([]);
  const [runId, setRunId] = useState<string | undefined>();
  const [seniority, setSeniority] = useState<string>('mid');
  const [done, setDone] = useState<DoneEvent | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [missing, setMissing] = useState<string[]>([]);
  const log = useRef<HTMLDivElement>(null);

  /**
   * Ask the server what it is missing before the user spends ten minutes finding out.
   * A container without `gitleaks` reaches S6 and fails there, having already paid for
   * generation.
   */
  useEffect(() => {
    void fetch('/api/health')
      .then((response) => response.json() as Promise<{ missing?: string[] }>)
      .then((health) => setMissing(health.missing ?? []))
      .catch(() => setMissing([]));
  }, []);

  const append = (line: Line): void => {
    setLines((current) => [...current, line]);
    requestAnimationFrame(() => log.current?.scrollTo({ top: log.current.scrollHeight }));
  };

  /** Read one SSE response to completion, handing each event to `onEvent`. */
  const consume = async (response: Response, onEvent: (event: QuarryEvent) => void) => {
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('No response body.');

    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;

      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseEvents(buffer);
      buffer = rest;
      for (const event of events) onEvent(event);
    }
  };

  const handleEvent = (event: QuarryEvent): void => {
    switch (event.kind) {
      case 'stage':
        append({ text: `${event.stage}  ${event.message}`, tone: 'plain' });
        break;
      case 'step':
        append({
          text: `    ${event.ok ? 'ok' : 'FAIL'}  ${event.name.padEnd(9)} ${event.detail}`,
          tone: event.ok ? 'ok' : 'fail',
        });
        break;
      case 'notice':
        append({ text: event.message, tone: 'notice' });
        break;
      case 'roles':
        setRunId(event.runId);
        setRoles(event.roles);
        setPhase('choosing');
        break;
      case 'done':
        setDone(event);
        setPhase('done');
        break;
      case 'error':
        setError(event.message);
        setPhase(roles.length > 0 ? 'choosing' : 'idle');
        break;
    }
  };

  const map = async (): Promise<void> => {
    setPhase('mapping');
    setLines([]);
    setRoles([]);
    setError(undefined);
    setDone(undefined);

    try {
      const response = await fetch('/api/map', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo }),
      });

      if (!response.ok && response.headers.get('content-type')?.includes('json') === true) {
        const failure = (await response.json()) as { error?: string };
        throw new Error(failure.error ?? 'Mapping failed.');
      }

      await consume(response, handleEvent);
      setPhase((current) => (current === 'mapping' ? 'idle' : current));
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      setPhase('idle');
    }
  };

  const generate = async (role: string): Promise<void> => {
    setPhase('generating');
    setError(undefined);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId, role, seniority }),
      });

      await consume(response, handleEvent);
      setPhase((current) => (current === 'generating' ? 'choosing' : current));
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      setPhase('choosing');
    }
  };

  const busy = phase === 'mapping' || phase === 'generating';
  const unready = missing.length > 0;

  return (
    <main>
      <header>
        <h1>Quarry</h1>
        <p>
          Reads a repository and writes a take-home that mirrors it — no source code from the
          original ever ships.
        </p>
      </header>

      <form
        onSubmit={(submitted) => {
          submitted.preventDefault();
          void map();
        }}
      >
        <input
          type="text"
          value={repo}
          placeholder="https://github.com/expressjs/express.git"
          onChange={(changed) => setRepo(changed.target.value)}
          disabled={busy}
          aria-label="Repository URL"
        />
        <button type="submit" disabled={busy || unready || repo.trim() === ''}>
          {phase === 'mapping' ? 'Reading…' : 'Read repo'}
        </button>
      </form>

      {unready && (
        <p className="error">
          This server is missing {missing.join(', ')}. Generation needs it and would fail part way
          through, so it is disabled.
        </p>
      )}

      {error !== undefined && <p className="error">{error}</p>}

      {roles.length > 0 && (
        <section>
          <h2>Roles</h2>
          <div className="cards">
            {roles.map((card) => (
              <button
                key={card.role}
                className={`card ${card.rating}`}
                disabled={!isOffered(card.rating) || busy || unready}
                onClick={() => void generate(card.role)}
              >
                <span className="role">{card.label}</span>
                <span className="rating">{card.rating}</span>
                <span className="reason">{card.reason}</span>
              </button>
            ))}
          </div>

          <div className="seniority">
            {SENIORITIES.map((level) => (
              <label key={level}>
                <input
                  type="radio"
                  name="seniority"
                  value={level}
                  checked={seniority === level}
                  disabled={busy}
                  onChange={() => setSeniority(level)}
                />
                {level}
              </label>
            ))}
          </div>
        </section>
      )}

      {lines.length > 0 && (
        <section>
          <h2>Progress</h2>
          <div className="log" ref={log}>
            {lines.map((line, index) => (
              <div key={index} className={line.tone}>
                {line.text}
              </div>
            ))}
            {busy && <div className="cursor">▍</div>}
          </div>
          {phase === 'generating' && (
            <p className="hint">
              Generation takes roughly 8–12 minutes. Every file is written from scratch, then
              installed, tested and checked against the source before anything is packaged.
            </p>
          )}
        </section>
      )}

      {done !== undefined && (
        <section className="done">
          <h2>Verified</h2>
          <p>
            <strong>
              {done.role} / {done.seniority} / {done.task}
            </strong>{' '}
            — {done.surfaceTitle}
          </p>
          <p className="meta">
            {(done.bytes / 1000).toFixed(1)} kB
            {done.costUsd === undefined ? '' : ` · $${done.costUsd.toFixed(2)}`}
            {done.repairs > 0 ? ` · ${done.repairs} repair round` : ''}
          </p>
          <a className="download" href={`/api/download/${done.runId}`} download>
            Download {done.zip}
          </a>
        </section>
      )}
    </main>
  );
}
