import type { MemoryBook, MemoryShelfView } from "@shared/memorySpace";

/** Unconfigured books share one mixed shelf; explicit per-book choices always win. */
export function mixedBookViews(
  books: readonly MemoryBook[]
): Map<number, MemoryShelfView> {
  const pattern: MemoryShelfView[] = [
    "horizontal",
    "horizontal",
    "vertical",
    "album",
    "vertical",
    "album",
  ];
  // Even a three-book collection should show all three orientations.
  const smallPattern: MemoryShelfView[] = ["horizontal", "vertical", "album"];
  const arrangement = books.length <= 3 ? smallPattern : pattern;
  return new Map(
    books.map((book, index) => [
      book.id,
      book.view ?? arrangement[index % arrangement.length],
    ])
  );
}
