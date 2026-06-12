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

  it("有故事视觉配方时优先注入原创 DNA，不再注入具名流派", async () => {
    let seen = "";
    await renderViaGate(
      {
        prompt: "窗边开花的小草",
        artDirection: {
          style: ["平涂风格化插图"],
          palette: ["低饱和青绿"],
          light: ["清晨柔侧光"],
          composition: ["主体偏侧"],
          material: ["纸张颗粒"],
          negative: ["摄影写实"],
        },
      },
      async prompt => {
        seen = prompt;
        return { ok: true };
      },
    );

    expect(seen).toContain("【故事视觉配方】");
    expect(seen).toContain("低饱和青绿");
    expect(seen).not.toContain("【美术流派·");
  });

  it("render 抛错时原样冒泡，不吞错", async () => {
    await expect(
      renderViaGate({ prompt: "x" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
