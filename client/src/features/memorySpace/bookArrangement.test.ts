import { expect, it } from "vitest";
import type { MemoryBook } from "@shared/memorySpace";
import { mixedBookViews } from "./bookArrangement";
const books = (count: number) =>
  Array.from(
    { length: count },
    (_, id) => ({ id, view: null }) as unknown as MemoryBook
  );
it("three books show three orientations; larger collections start with a stack, spine and cover", () => {
  expect([...mixedBookViews(books(3)).values()]).toEqual([
    "horizontal",
    "vertical",
    "album",
  ]);
  expect([...mixedBookViews(books(6)).values()].slice(0, 4)).toEqual([
    "horizontal",
    "horizontal",
    "vertical",
    "album",
  ]);
});
it("keeps each explicit choice, including when its neighbours use automatic placement", () => {
  const collection = books(6);
  collection[0].view = "album";
  collection[3].view = "horizontal";
  const views = mixedBookViews(collection);
  expect(views.get(0)).toBe("album");
  expect(views.get(1)).toBe("horizontal");
  expect(views.get(3)).toBe("horizontal");
});
