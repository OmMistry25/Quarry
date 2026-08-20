import type { QuarryEvent } from './events';

/** One SSE frame. Newline-delimited JSON inside `data:`, which is what EventSource expects. */
export function encodeEvent(event: QuarryEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parse a chunk of an SSE body into events.
 *
 * The browser side does its own framing rather than using `EventSource`, because starting a
 * run is a POST — `EventSource` can only GET, and putting a repo URL and role in a query
 * string to work around that would be worse.
 *
 * Returns the events it could parse and whatever trailing partial frame is left, which the
 * caller feeds back in with the next chunk.
 */
export function parseEvents(buffer: string): { events: QuarryEvent[]; rest: string } {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() ?? '';
  const events: QuarryEvent[] = [];

  for (const frame of frames) {
    const line = frame.split('\n').find((candidate) => candidate.startsWith('data: '));
    if (line === undefined) continue;
    events.push(JSON.parse(line.slice('data: '.length)) as QuarryEvent);
  }

  return { events, rest };
}

/**
 * Run `body`, streaming whatever it emits as SSE.
 *
 * Errors become a final `error` event rather than a dead socket: a 500 mid-stream shows the
 * browser nothing, and every failure here — an unsupported role, a package that would not
 * verify — is one the user needs the text of.
 */
export function streamResponse(
  body: (emit: (event: QuarryEvent) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: QuarryEvent): void => {
        controller.enqueue(encoder.encode(encodeEvent(event)));
      };

      try {
        await body(emit);
      } catch (error) {
        emit({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
