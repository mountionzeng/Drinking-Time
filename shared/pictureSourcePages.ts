export type PicturePage = { label: string; page: string; title?: string };

// Consume a citation as one span, leaving the surrounding description and its saved offsets intact.
const digits = "[0-9零〇一二两三四五六七八九十百千]{1,8}";
const pageSpan =
  "第\\s*(" + digits + "(?:\\s*[-—–至到]\\s*(?:第\\s*)?" + digits + ")?)\\s*页";
const citedPage = new RegExp(
  '“[^”\\n]*”|「[^」\\n]*」|『[^』\\n]*』|"[^"\\n]*"|' +
    "(?:[（(]\\s*)?(?:(?:见|参见|出自|取自|参考(?:素材)?|出处|来源)\\s*[:：]?\\s*)?\\[?(?:《([^》\\n]{1,100})》\\s*)?" +
    pageSpan,
  "gu"
);
const pageKey = (value: string) =>
  value.replace(/\s|第/g, "").replace(/[—–至到]/g, "-");

function pageNumber(raw: string) {
  if (/^\d+$/u.test(raw)) return Number(raw);
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  const characters = raw.replaceAll("〇", "零").replaceAll("两", "二");
  let total = 0,
    part = 0;
  for (const ch of characters) {
    if (units[ch]) {
      total += (part || 1) * units[ch];
      part = 0;
    } else {
      const n = "零一二三四五六七八九".indexOf(ch);
      if (n < 0) return NaN;
      part = part * 10 + n;
    }
  }
  return total + part;
}

function pageBounds(raw: string) {
  const [first, last = first] = pageKey(raw).split("-");
  return [pageNumber(first), pageNumber(last)];
}

export function pictureSourcePages(raw: string) {
  const pages: PicturePage[] = [];
  let leading = 0,
    end = 0,
    text = "";
  for (const match of raw.matchAll(citedPage)) {
    const [citation, title, number] = match;
    if (!number) continue; // Quoted lettering is something the artist is meant to see.
    const start = match.index!;
    const before = raw.slice(0, start),
      after = raw.slice(start + citation.length);
    if (
      /(?:写着|印着|显示为|标着|写上|印上|字样为|页码是|页码为)\s*[:：]?\s*$/u.test(
        before
      ) ||
      /^(?:字样|这几个字|的页码)/u.test(after)
    )
      continue;
    const page = pageKey(number);
    const label = (title ? "《" + title + "》" : "") + "第" + page + "页";
    if (!pages.some(p => p.label === label))
      pages.push({ label, page, ...(title ? { title } : {}) });
    let until = start + citation.length;
    if (citation.includes("["))
      until +=
        after.match(/^\]\((?:[^()\s]|\([^()\s]*\))+\)/u)?.[0].length ?? 0;
    if (/^[（(]/u.test(citation) && /^[)）]/u.test(raw.slice(until))) until++;
    until += raw.slice(until).match(/^(?:中的|上的|里的|的)?[ \t]*/u)![0]
      .length;
    // At a sentence boundary discard the citation's separator, never punctuation belonging to a quote.
    if (start === leading || /[，。；：:\n]\s*$/u.test(before))
      until += raw.slice(until).match(/^[，,：:；;。]?[ \t]*/u)![0].length;
    text += raw.slice(end, start);
    if (!raw.slice(leading, start).trim()) leading = until;
    end = until;
  }
  return { text: text + raw.slice(end), pages, leading };
}

/** Only material explicitly saved as a source can supply a page excerpt. */
export function pageExcerpts(
  sources: Array<{ id: string; source: string; state: string; text: string }>,
  page: string,
  title?: string
) {
  const [first, last] = pageBounds(page);
  return sources.flatMap(row => {
    if (row.state !== "source") return [];
    const lines = row.text.split("\n");
    if (
      title &&
      ![row.source, lines[0]].some(s => s.includes("《" + title + "》"))
    )
      return [];
    const sections: string[] = [];
    let current: string[] | undefined;
    for (const line of lines) {
      const m =
        /^\s*(?:#{1,6}\s*|\*\*)?(第\s*[^页\n]{1,24}页)(?:\*\*)?\s*(?:[:：]|$)/u.exec(
          line
        );
      if (m) {
        if (current) sections.push(current.join("\n").trim());
        const heading = pictureSourcePages(m[1]).pages[0];
        const [start, end] = heading ? pageBounds(heading.page) : [NaN, NaN];
        current =
          first <= last && start <= end && start <= last && end >= first
            ? [line.trim()]
            : undefined;
      } else if (current) current.push(line);
    }
    if (current) sections.push(current.join("\n").trim());
    return sections.length
      ? [{ id: row.id, source: row.source, text: sections.join("\n\n") }]
      : [];
  });
}
