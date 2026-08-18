/**
 * Deterministic JSON for hashes and immutable-value comparisons.
 * Object keys are sorted recursively; arrays retain their original order.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) =>
        `${JSON.stringify(key)}:${canonicalJsonStringify(item)}`
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
