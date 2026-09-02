import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { clearStyleLibraryCache, getAllStyles } from "./styleLibrary";

const libraryDir = path.resolve(
  import.meta.dirname,
  "../../docs/style-library"
);

type WordBankGroup = "A" | "B" | "C" | "D";

function listedWordBankCards(
  markdown: string
): Array<{ id: string; group: WordBankGroup }> {
  let group: WordBankGroup | undefined;
  const cards: Array<{ id: string; group: WordBankGroup }> = [];

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^## ([A-D])\./)?.[1] as
      | WordBankGroup
      | undefined;
    if (heading) group = heading;

    const id = line.match(/^\| `([a-z0-9-]+)` \|/)?.[1];
    if (id && group) cards.push({ id, group });
  }

  return cards;
}

describe("style-library human curation word bank", () => {
  it("lists every executable YAML entry exactly once", () => {
    clearStyleLibraryCache();
    const entryIds = getAllStyles(path.join(libraryDir, "entries"))
      .map(entry => entry.id)
      .sort();
    const wordBankCards = listedWordBankCards(
      fs.readFileSync(path.join(libraryDir, "WORD_BANK.md"), "utf8")
    );
    const wordBankIds = wordBankCards.map(card => card.id);

    expect(new Set(wordBankIds).size).toBe(wordBankIds.length);
    expect(wordBankIds.sort()).toEqual(entryIds);
  });

  it("keeps each human-facing group aligned with executable status and selection mode", () => {
    clearStyleLibraryCache();
    const entries = new Map(
      getAllStyles(path.join(libraryDir, "entries")).map(entry => [
        entry.id,
        entry,
      ])
    );
    const cards = listedWordBankCards(
      fs.readFileSync(path.join(libraryDir, "WORD_BANK.md"), "utf8")
    );

    for (const card of cards) {
      const entry = entries.get(card.id);
      expect(entry, `${card.id} should exist in YAML`).toBeDefined();

      if (card.group === "A" || card.group === "B") {
        expect(entry?.status, `${card.id} should be active`).toBe("active");
        expect(
          entry?.automatic_selection,
          `${card.id} should be automatic`
        ).toBeDefined();
      } else if (card.group === "C") {
        expect(entry?.status, `${card.id} should be active`).toBe("active");
        expect(
          entry?.automatic_selection,
          `${card.id} should stay manual`
        ).toBeUndefined();
      } else {
        expect(entry?.status, `${card.id} should remain draft`).toBe("draft");
      }
    }
  });
});
