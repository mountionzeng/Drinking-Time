/**
 * Shared helpers for parsing loose / fenced JSON from LLM responses.
 *
 * Only `parseJsonLoose` is exported; the rest are module-private utilities.
 */

function stripJson(raw: string): string {
  return raw
    .trim()
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

function stripJsonComments(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    const next = raw[i + 1];

    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      out += char;
      escaped = inString;
      continue;
    }

    if (char === '"') {
      out += char;
      inString = !inString;
      continue;
    }

    if (!inString && char === "/" && next === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
      out += "\n";
      continue;
    }

    if (!inString && char === "/" && next === "*") {
      i += 2;
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
      i++;
      continue;
    }

    out += char;
  }

  return out;
}

function sanitizeJsonCandidate(raw: string): string {
  return stripJsonComments(stripJson(raw))
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function extractFencedJsonBlocks(raw: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw))) {
    if (match[1]?.trim()) blocks.push(match[1]);
  }
  return blocks;
}

function extractBalancedJsonObjects(raw: string): string[] {
  const candidates: string[] = [];

  for (let start = 0; start < raw.length; start++) {
    if (raw[start] !== "{") continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < raw.length; i++) {
      const char = raw[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = inString;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === "{") depth++;
      if (char === "}") depth--;

      if (depth === 0) {
        candidates.push(raw.slice(start, i + 1));
        break;
      }
    }
  }

  return candidates;
}

export function parseJsonLoose<T>(raw: string): T {
  const candidates = [
    ...extractFencedJsonBlocks(raw),
    stripJson(raw),
    ...extractBalancedJsonObjects(raw),
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(sanitizeJsonCandidate(candidate)) as T;
    } catch {
      // Try the next possible JSON span.
    }
  }

  throw new Error("Non-JSON response");
}
