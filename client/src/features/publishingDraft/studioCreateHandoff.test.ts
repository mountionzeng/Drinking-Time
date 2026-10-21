import { expect, it } from "vitest";
import { saveStudioCreateHandoff, readStudioCreateHandoff, clearStudioCreateHandoff } from "./studioCreateHandoff";

it("hands the selected story and instruction to the same account without putting text in the URL", () => {
  const map = new Map<string, string>();
  const storage = { setItem: (k: string, v: string) => { map.set(k, v); }, getItem: (k: string) => map.get(k) ?? null, removeItem: (k: string) => { map.delete(k); } };
  const request = { id: "request-1", storyId: 7, kind: "music" as const, instruction: "Quiet piano" };
  const url = saveStudioCreateHandoff(storage, 8, request, 1000);
  expect(url).toBe("/editing?storyId=7&createRequest=request-1");
  expect(readStudioCreateHandoff(storage, request.id, 8, 2000)).toEqual(request);
  expect(readStudioCreateHandoff(storage, request.id, 9, 2000)).toBeNull();
  expect(readStudioCreateHandoff(storage, request.id, 8, 601001)).toBeNull();
  clearStudioCreateHandoff(storage, request.id);
  expect(readStudioCreateHandoff(storage, request.id, 8, 2000)).toBeNull();
});

it("does not accept malformed or arbitrary creation kinds", () => {
  const storage = { getItem: () => JSON.stringify({ userId: 8, at: 1000, request: { id: "x", storyId: 7, kind: "delete", instruction: "" } }), removeItem: () => {} };
  expect(readStudioCreateHandoff(storage, "x", 8, 2000)).toBeNull();
  expect(readStudioCreateHandoff({ ...storage, getItem: () => "{" }, "x", 8, 2000)).toBeNull();
});
