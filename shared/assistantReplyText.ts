/** Some gateways include a reasoning preamble in the ordinary reply field. */
export function stripAssistantReasoning(raw: string): string {
  let text = raw.trim();
  while (/^<(?:think|thinking)>/i.test(text)) {
    text = text
      .replace(/^<(think|thinking)>[\s\S]*?(?:<\/\1>|$)/i, "")
      .trim();
  }
  return text;
}
