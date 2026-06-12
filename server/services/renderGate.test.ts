import { describe, it, expect } from "vitest";
import { renderViaGate } from "./renderGate";

describe("renderViaGate（出图网关）", () => {
  it("美术 v1：render 收到的 prompt = 原 prompt + 注入的美术流派", async () => {
    let seen = "";
    await renderViaGate(
      { prompt: "a cat on a wall" },
      async (prompt) => {
        seen = prompt;
        return { ok: true };
      },
    );
    expect(seen).toContain("a cat on a wall"); // 原 prompt 保留
    expect(seen).toContain("【美术流派·"); // 注入了一个流派
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
