/**
 * Agents are asked for bare JSON and mostly comply, but "mostly" is not a contract. This
 * pulls the JSON object out of a reply that may be fenced, prefaced, or trailed with prose.
 *
 * Deliberately conservative: it finds the outermost balanced `{…}` rather than regexing, so
 * a `}` inside a string literal cannot truncate the object.
 */
export function extractJsonObject(reply: string): string | undefined {
  const fenced = stripCodeFence(reply);
  const source = fenced ?? reply;

  const start = source.indexOf('{');
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return undefined;
}

/** ```json … ``` or ``` … ``` */
function stripCodeFence(reply: string): string | undefined {
  const match = /```(?:json)?\s*\n([\s\S]*?)```/.exec(reply);
  return match?.[1];
}
