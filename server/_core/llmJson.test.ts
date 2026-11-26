import { expect, it } from "vitest";
import { parseJsonLoose, parseJsonObjectLoose } from "./llmJson";

it("still returns the first JSON value for parseJsonLoose", () => {
  expect(parseJsonLoose("```json\n2\n```\n{\"ok\":true}")).toBe(2);
});

it("skips a leading JSON number and returns the layout object", () => {
  const raw = [
    "```json",
    "2",
    "```",
    '{"observed":"two people on a balcony","people":[{"role":"dancer","count":"one","clothing":"coat","position":"left","action":"waves","target":"","gaze":""}],"objects":[],"omit":[],"uncertain":[]}',
  ].join("\n");
  expect(parseJsonObjectLoose(raw)).toMatchObject({ observed: "two people on a balcony" });
  expect(parseJsonObjectLoose("3\n{\"observed\":\"ok\",\"people\":[],\"objects\":[]}")).toMatchObject({ observed: "ok" });
});

it("unwraps a one-level object wrapper", () => {
  expect(parseJsonObjectLoose(JSON.stringify({
    data: { observed: "inside", people: [], objects: [], omit: [], uncertain: [] },
  }))).toMatchObject({ observed: "inside" });
});

it("rejects a payload that is only a number", () => {
  expect(() => parseJsonObjectLoose("```json\n2\n```")).toThrow("Non-JSON object");
  expect(() => parseJsonObjectLoose("7")).toThrow("Non-JSON object");
});
