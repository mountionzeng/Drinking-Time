import { expect, it } from "vitest";
import { intentAnswer, textSceneIntent } from "./textSceneIntent";
import type { SceneLayout } from "./shotSceneDirection";

it("keeps each action with its actor, number and original position", () => {
  const source = "一名通信员骑马奔向城门，城墙上的伪军挥手拒绝。";
  const { beats, question } = textSceneIntent(source);
  expect(beats).toEqual([
    { subject: "通信员", evidence: "一名通信员骑马奔向城门" },
    { subject: "伪军", evidence: "城墙上的伪军挥手拒绝" },
  ]);
  expect(question).toEqual({ kind: "gaze", focus: "通信员" });
  const answer = intentAnswer(question, "抬头看城墙上的人");
  expect(answer).toContain("通信员的视线");
  expect(textSceneIntent(source, answer).question).toBeUndefined();
  expect(textSceneIntent(source, "伪军望向城外").question).toEqual(question);
  expect(textSceneIntent("通信员骑马奔向城门，抬头看城头。城头伪军挥手。").question).toBeUndefined();
});

it("only asks for the actor whose position is missing", () => {
  const s = "穿围裙的厨师站在窗边。小满接过碗。";
  expect(textSceneIntent(s).question).toEqual({ kind: "position", focus: "小满" });
  expect(textSceneIntent(s, "小满在桌旁").question).toBeUndefined();
  expect(textSceneIntent("A dancer stands on the balcony. A violinist sits beside the stage.").question).toBeUndefined();
});

it("keeps ambiguous and negated clauses intact without inventing cast", () => {
  const s = "姐姐把花递给妹妹，她挥手。路人没有挥手。";
  const r = textSceneIntent(s);
  expect(r.question).toEqual({ kind: "actor", focus: "她挥手" });
  expect(intentAnswer(r.question, "妹妹")).toContain("「她挥手」的动作归属：妹妹");
  expect(r.beats.map(b => b.subject)).toEqual(["姐姐", "她", ""]);
  expect(textSceneIntent("对方挥手").question?.kind).toBe("actor");
  expect(textSceneIntent("姐姐把花递给妹妹，她向姐姐挥手").question?.kind).toBe("actor");
  expect(textSceneIntent("女孩朝门边的朋友挥手").beats).toEqual([{ subject: "", evidence: "女孩朝门边的朋友挥手" }]);
});

it("keeps a landscape empty and excludes labelled off-screen content", () => {
  const r = textSceneIntent("画面：一座空桥。\n旁白：「三名水手在甲板上挥手。」\n字幕：清晨");
  expect(r).toEqual({ beats: [{ subject: "", evidence: "一座空桥" }] });
  expect(textSceneIntent("旁白：他骑马。")).toEqual({ beats: [], question: { kind: "visual", focus: "" } });
  expect(intentAnswer(undefined, "  ")).toBe("");
});

it("uses an explicitly requested layout, retaining the first composition question", () => {
  const layout: SceneLayout = { observed: "", people: [], objects: [{ name: "纸船", position: "窗边" }], omit: [], uncertain: ["要几只船？"] };
  expect(textSceneIntent("", "", layout)).toEqual({ beats: [{ subject: "纸船", evidence: "纸船 · 窗边" }],
    question: { kind: "model", focus: "要几只船？" } });
});
