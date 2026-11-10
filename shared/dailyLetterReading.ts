/** Saved creative writing is a reference, never autobiographical evidence. */
export type DailyLetterWork = {
  storyId: number;
  title: string;
  excerpt: string;
  savedOn: string;
  savedAt?: string;
};

export type DailyLetterWorkSource = Omit<DailyLetterWork, "excerpt">;

export function dailyLetterReadingContext(
  works: DailyLetterWork[],
  generatedAt: string | null,
  reference: unknown
) {
  const raw =
    reference && typeof reference === "object" && "workSources" in reference
      ? reference.workSources
      : null;
  const workSources: DailyLetterWorkSource[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (
        !item ||
        typeof item !== "object" ||
        !Number.isSafeInteger(item.storyId) ||
        typeof item.title !== "string" ||
        typeof item.savedOn !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(item.savedOn)
      )
        continue;
      workSources.push({
        storyId: item.storyId,
        title: item.title.slice(0, 100),
        savedOn: item.savedOn,
        ...(typeof item.savedAt === "string" &&
        Number.isFinite(Date.parse(item.savedAt))
          ? { savedAt: item.savedAt }
          : {}),
      });
      if (workSources.length === 2) break;
    }
  }
  const cutoff = generatedAt ? Date.parse(generatedAt) : NaN;
  return {
    // This is today's read-only availability, not a claim about what the old letter read.
    savedWorks: works.map(work => ({
      ...work,
      excerpt: work.excerpt.slice(0, 200),
    })),
    workSources,
    hasSourceReceipt: Array.isArray(raw),
    hasNewerWorks:
      Number.isFinite(cutoff) &&
      works.some(work => work.savedAt && Date.parse(work.savedAt) > cutoff),
  };
}

export type DailyLetterReadingContext = ReturnType<
  typeof dailyLetterReadingContext
>;
