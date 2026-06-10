import { describe, it, expect } from "vitest";
import { renderViaGate } from "./renderGate";

describe("renderViaGate（出图网关）", () => {
  it("本轮 identity：把 ctx.prompt 原样交给 render（即便带了参考图 / 镜号等信号）", async () => {
    let seen = "";
    const r = await renderViaGate(
      {
        prompt: "a cat on a wall",
        shotNo: "SH01",
        referenceImages: ["user.jpg"],
        intent: "改暖一点",
      },
      async (prompt) => {
        seen = prompt;
        return { ok: true, prompt };
      },
    );
    expect(seen).toBe("a cat on a wall");
    expect(r).toEqual({ ok: true, prompt: "a cat on a wall" });
  });

  it("render 的返回值原样透传（保留各生成器自己的返回形）", async () => {
    const r = await renderViaGate({ prompt: "x" }, async () => ({
      url: "http://img/1.png",
    }));
    expect(r).toEqual({ url: "http://img/1.png" });
  });

  it("render 抛错时原样冒泡，不吞错", async () => {
    await expect(
      renderViaGate({ prompt: "x" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
