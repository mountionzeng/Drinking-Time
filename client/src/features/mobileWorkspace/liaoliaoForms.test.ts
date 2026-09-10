import { describe, expect, it } from "vitest";

import {
  LIAOLIAO_FORMS,
  liaoliaoForm,
  liaoliaoSpriteStyle,
  navIconPaths,
} from "./liaoliaoForms";
import { composeArchivedBody } from "./MobileArchiveSheet";

describe("聊聊的五种外形", () => {
  // 「五种外形各不相同，不能只换颜色」——所以断言的是形状本身不同，
  // 不是颜色不同。
  it("gives every element its own body and its own nav icons", () => {
    expect(LIAOLIAO_FORMS.map(form => form.element)).toEqual([
      "metal",
      "wood",
      "water",
      "fire",
      "earth",
    ]);

    for (const page of ["stories", "chat", "me"] as const) {
      const drawn = LIAOLIAO_FORMS.map(form =>
        navIconPaths(page, form.element).join("|")
      );
      expect(new Set(drawn).size).toBe(5);
    }
  });

  // 水彩横排图是五等分的精灵图，第 n 格在 n*25%。取错格就会显示成别的角色。
  it("points at the right frame of the five-form sprite", () => {
    expect(liaoliaoSpriteStyle("metal").backgroundPosition).toBe("0% center");
    expect(liaoliaoSpriteStyle("earth").backgroundPosition).toBe("100% center");
    expect(liaoliaoSpriteStyle("water").backgroundPosition).toBe("50% center");
    expect(liaoliaoForm("fire").label).toBe("火 · 茶壶");
  });
});

describe("存入故事", () => {
  // 追加必须留住原文——这是真机上最难自己发现、代价又最大的一条。
  it("keeps the existing body when appending", () => {
    expect(composeArchivedBody("原来的正文", "新的一段", "append")).toBe(
      "原来的正文\n\n新的一段"
    );
    // 原文末尾的空白不该越积越多
    expect(composeArchivedBody("原来的正文\n\n\n", "新的一段", "append")).toBe(
      "原来的正文\n\n新的一段"
    );
    // 空正文追加，不要在开头留空行
    expect(composeArchivedBody("", "新的一段", "append")).toBe("新的一段");
  });

  it("replaces the whole body only when replacing", () => {
    expect(composeArchivedBody("原来的正文", "新的一段", "replace")).toBe(
      "新的一段"
    );
  });
});
