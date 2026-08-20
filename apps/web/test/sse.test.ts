import { describe, expect, it } from 'vitest';

import type { QuarryEvent } from '../lib/events';
import { encodeEvent, parseEvents } from '../lib/sse';

const stage = (message: string): QuarryEvent => ({ kind: 'stage', stage: 'S5', message });

describe('SSE framing', () => {
  it('round-trips an event', () => {
    const { events, rest } = parseEvents(encodeEvent(stage('generating…')));

    expect(events).toEqual([stage('generating…')]);
    expect(rest).toBe('');
  });

  it('reads several events from one chunk', () => {
    const chunk = encodeEvent(stage('one')) + encodeEvent(stage('two'));

    expect(parseEvents(chunk).events).toHaveLength(2);
  });

  /**
   * The case that matters: a network chunk boundary lands mid-frame. Parsing greedily would
   * throw on the half-written JSON and kill the progress stream while the run carried on.
   */
  it('holds a partial frame back until the rest arrives', () => {
    const whole = encodeEvent(stage('a long message that gets split'));
    const cut = Math.floor(whole.length / 2);

    const first = parseEvents(whole.slice(0, cut));
    expect(first.events).toEqual([]);

    const second = parseEvents(first.rest + whole.slice(cut));
    expect(second.events).toEqual([stage('a long message that gets split')]);
  });

  it('ignores a frame with no data line, which is what a keep-alive comment is', () => {
    expect(parseEvents(': keep-alive\n\n').events).toEqual([]);
  });
});
