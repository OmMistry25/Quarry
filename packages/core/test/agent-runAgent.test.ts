import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { AgentInvocation, AgentReply, AgentTransport } from '../src/agent/claude.js';
import { runAgent, type AgentAttempt } from '../src/agent/runAgent.js';
import { QuarryError } from '../src/errors.js';

const Schema = z.object({ name: z.string(), count: z.number().int() });

/** Replies in order; records what it was asked. */
function scriptedTransport(replies: string[]): AgentTransport & { calls: AgentInvocation[] } {
  const calls: AgentInvocation[] = [];
  let index = 0;

  const transport = async (invocation: AgentInvocation): Promise<AgentReply> => {
    calls.push(invocation);
    const text = replies[Math.min(index, replies.length - 1)] ?? '';
    index += 1;
    return { text, costUsd: 0.1 };
  };

  return Object.assign(transport, { calls });
}

describe('runAgent', () => {
  it('returns parsed data on a clean first attempt', async () => {
    const transport = scriptedTransport(['{"name":"api","count":2}']);

    const result = await runAgent({ stage: 's2', prompt: 'go', schema: Schema, transport });

    expect(result.data).toEqual({ name: 'api', count: 2 });
    expect(result.attempts).toBe(1);
    expect(transport.calls).toHaveLength(1);
  });

  it('accumulates cost across attempts', async () => {
    const transport = scriptedTransport(['nonsense', '{"name":"api","count":2}']);

    const result = await runAgent({ stage: 's2', prompt: 'go', schema: Schema, transport });

    expect(result.attempts).toBe(2);
    expect(result.costUsd).toBeCloseTo(0.2);
  });

  it('retries with the specific zod errors appended, not a bare "try again"', async () => {
    const transport = scriptedTransport([
      '{"name":"api","count":"two"}',
      '{"name":"api","count":2}',
    ]);

    await runAgent({ stage: 's2', prompt: 'ORIGINAL', schema: Schema, transport });

    const retryPrompt = transport.calls[1]?.prompt ?? '';
    expect(retryPrompt).toContain('ORIGINAL');
    expect(retryPrompt).toContain('previous reply was rejected');
    // The field that actually failed must be named, or the model just guesses again.
    expect(retryPrompt).toContain('count');
  });

  it('feeds back the reason when the reply had no JSON at all', async () => {
    const transport = scriptedTransport(['I am unable to help.', '{"name":"api","count":1}']);

    await runAgent({ stage: 's2', prompt: 'go', schema: Schema, transport });

    expect(transport.calls[1]?.prompt).toContain('no JSON object');
  });

  it('feeds back the reason when the JSON was malformed', async () => {
    const transport = scriptedTransport(['{"name":"api",}', '{"name":"api","count":1}']);

    await runAgent({ stage: 's2', prompt: 'go', schema: Schema, transport });

    expect(transport.calls[1]?.prompt).toMatch(/did not parse/i);
  });

  it('does not compound feedback across attempts', async () => {
    const transport = scriptedTransport(['no json', '{"name":1}', '{"name":"api","count":1}']);

    await runAgent({ stage: 's2', prompt: 'ORIGINAL', schema: Schema, transport });

    const third = transport.calls[2]?.prompt ?? '';
    // Each retry restates the original prompt plus *one* rejection block.
    expect(third.match(/previous reply was rejected/g)).toHaveLength(1);
  });

  it('makes exactly retries+1 attempts before giving up', async () => {
    const transport = scriptedTransport(['nope']);

    await expect(
      runAgent({ stage: 's2', prompt: 'go', schema: Schema, transport, retries: 2 }),
    ).rejects.toBeInstanceOf(QuarryError);

    expect(transport.calls).toHaveLength(3);
  });

  it('defaults to 2 retries per the architecture doc', async () => {
    const transport = scriptedTransport(['nope']);

    await runAgent({ stage: 's2', prompt: 'go', schema: Schema, transport }).catch(() => undefined);

    expect(transport.calls).toHaveLength(3);
  });

  it('fails with the stage and the last problem, so a bad run is diagnosable', async () => {
    const transport = scriptedTransport(['{"name":"api","count":"two"}']);

    const error = await runAgent({
      stage: 's2',
      prompt: 'go',
      schema: Schema,
      transport,
      retries: 0,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(QuarryError);
    expect((error as QuarryError).stage).toBe('s2');
    expect((error as QuarryError).message).toContain('count');
  });

  it('reports every attempt to onAttempt', async () => {
    const transport = scriptedTransport(['nope', '{"name":"api","count":1}']);
    const seen: AgentAttempt[] = [];

    await runAgent({
      stage: 's2',
      prompt: 'go',
      schema: Schema,
      transport,
      onAttempt: (attempt) => seen.push(attempt),
    });

    expect(seen.map((a) => a.outcome)).toEqual(['invalid-json', 'ok']);
    expect(seen.every((a) => a.stage === 's2')).toBe(true);
  });

  it('runs the agent outside the repo by default, so CLAUDE.md cannot leak in', async () => {
    const transport = scriptedTransport(['{"name":"api","count":1}']);

    await runAgent({ stage: 's2', prompt: 'go', schema: Schema, transport });

    const cwd = transport.calls[0]?.cwd ?? '';
    expect(cwd).not.toContain('Quarry');
    expect(cwd).toContain('quarry-agent-');
  });

  it('honours an explicit cwd when a stage needs one', async () => {
    const transport = scriptedTransport(['{"name":"api","count":1}']);

    await runAgent({ stage: 's5', prompt: 'go', schema: Schema, transport, cwd: '/tmp/target' });

    expect(transport.calls[0]?.cwd).toBe('/tmp/target');
  });

  it('propagates a transport failure instead of burning retries on it', async () => {
    const transport = vi.fn(async () => {
      throw new QuarryError('The `claude` CLI is not on PATH.');
    });

    await expect(
      runAgent({ stage: 's2', prompt: 'go', schema: Schema, transport }),
    ).rejects.toThrow(/not on PATH/);

    expect(transport).toHaveBeenCalledTimes(1);
  });
});
