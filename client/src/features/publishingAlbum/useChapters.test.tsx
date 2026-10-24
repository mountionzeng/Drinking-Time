import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChapters } from "./useChapters";

const queries = vi.hoisted(() => ({
  list: undefined as undefined | Array<{ id: number }>,
  detail: undefined as undefined | { chapter: { id: number }; imageUrls: Record<string, string> },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
    chapters: {
      list: { useQuery: () => ({ data: queries.list, isLoading: queries.list === undefined }) },
      get: { useQuery: () => ({ data: queries.detail, isLoading: queries.detail === undefined }) },
      save: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));

function Probe() {
  const { active } = useChapters(113);
  return <p>{active?.id ?? "no active chapter"}</p>;
}

describe("chapter query loading states", () => {
  beforeEach(() => { queries.list = undefined; queries.detail = undefined; });
  it("renders while the first list and detail have not arrived", () => {
    expect(renderToStaticMarkup(<Probe />)).toContain("no active chapter");
  });
  it("renders an empty story without attempting to read a missing detail", () => {
    queries.list = [];
    expect(renderToStaticMarkup(<Probe />)).toContain("no active chapter");
  });
  it("waits for the selected chapter detail", () => {
    queries.list = [{ id: 2 }];
    expect(renderToStaticMarkup(<Probe />)).toContain("no active chapter");
    queries.detail = { chapter: { id: 1 }, imageUrls: {} };
    expect(renderToStaticMarkup(<Probe />)).toContain("no active chapter");
    queries.detail = { chapter: { id: 2 }, imageUrls: {} };
    expect(renderToStaticMarkup(<Probe />)).toBe("<p>2</p>");
  });
});
