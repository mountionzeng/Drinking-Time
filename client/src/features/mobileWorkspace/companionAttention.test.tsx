import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { companionAttention } from "./companionAttention";
import { NayinCompanion } from "./NayinCompanion";
import { XiaoyiBird } from "./XiaoyiBird";
import { MOOD_MOTION } from "@/features/nayin/views/EmotiveWuxingIcon";

describe("companion request feedback", () => {
  it("stops attention motion when closed and returns to listening when a request ends or fails", () => {
    expect(companionAttention(false, true)).toBe("idle");
    expect(companionAttention(false, false)).toBe("idle");
    expect(companionAttention(true, true)).toBe("thinking");
    expect(companionAttention(true, false)).toBe("listening");
  });
  for (const element of ["metal", "wood", "water", "fire", "earth"] as const) {
    it(`reuses ${element}'s existing thinking and listening faces`, () => {
      const thinking = renderToStaticMarkup(<NayinCompanion element={element} active={false} docked={false} attention="thinking" />);
      const listening = renderToStaticMarkup(<NayinCompanion element={element} active={false} docked={false} attention="listening" />);
      expect(thinking).toContain('data-attention="thinking"');
      expect(thinking).toContain('聊聊 · 想着呢');
      expect(listening).toContain('聊聊 · 安心');
      expect(thinking).toContain('data-playing="false"');
    });
  }
  it("uses existing bird sheets with distinct listening and thinking poses", () => {
    const thinking = renderToStaticMarkup(<XiaoyiBird active={false} attention="thinking" />);
    const listening = renderToStaticMarkup(<XiaoyiBird active={false} attention="listening" />);
    expect(thinking).toContain('/shiguang/companion/expressions.webp');
    expect(listening).toContain('/shiguang/companion/wave.webp');
    expect(thinking).toContain('data-gesture=""');
    expect(listening).toContain('data-gesture=""');
  });
  it("keeps the reused body movement small", () => {
    for (const mood of ["thinking", "trust"] as const) {
      expect(Math.max(...(MOOD_MOTION[mood].rotate as number[]).map(Math.abs))).toBeLessThanOrEqual(3);
    }
  });
});
