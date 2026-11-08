import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
  StoryboardManuscriptTable,
  type ManuscriptEntry,
} from "./StoryboardManuscriptTable";
import { buildStoryboardMatrixLayout } from "./storyboardMatrixLayout";
vi.stubGlobal("React", React);
const entries = [
  {
    stableShotId: "a",
    originalIndex: 0,
    shot: {
      stableShotId: "a",
      shotNo: 1,
      cueCode: "0101",
      dialogue: "甲的台词",
      subject: "甲",
      action: "甲走过来",
    },
  },
  {
    stableShotId: "b",
    originalIndex: 1,
    shot: {
      stableShotId: "b",
      shotNo: 2,
      cueCode: "0201",
      dialogue: "乙的台词",
      subject: "乙",
      action: "乙挥手",
    },
  },
] as ManuscriptEntry[];
const callbacks = {
  visible: true,
  selectedShotNo: 2,
  onSelect: vi.fn(),
  onSave: vi.fn(),
  onGenerate: vi.fn(),
  isBusy: () => false,
  voiceError: () => undefined,
  timingLabel: () => "0–3s",
  renderMedia: (entry: ManuscriptEntry) => (
    <img src={`/${entry.stableShotId}.png`} />
  ),
};
it("follows the same timeline layout as the matrix without renumbering or separating media and text", () => {
  const layout = buildStoryboardMatrixLayout({
    entries,
    timings: [
      { stableShotId: "a", startFrame: 120, endFrame: 180 },
      { stableShotId: "b", startFrame: 0, endFrame: 60 },
    ],
    pixelsPerFrame: 1,
    targetWidth: 180,
  });
  const html = renderToStaticMarkup(
    <StoryboardManuscriptTable {...callbacks} entries={layout.entries} />
  );
  expect(html.indexOf('data-shot-code="0201"')).toBeLessThan(
    html.indexOf('data-shot-code="0101"')
  );
  const row = html.slice(
    html.indexOf('data-shot-id="b"'),
    html.indexOf('data-shot-id="a"')
  );
  expect(row).toContain("乙的台词");
  expect(row).toContain("/b.png");
  expect(row).not.toContain("甲的台词");
  expect(row).toContain('aria-pressed="true"');
  expect(row).toContain("生成 0201 的素材");
  expect(callbacks.onSave).not.toHaveBeenCalled();
  expect(callbacks.onGenerate).not.toHaveBeenCalled();
});
it("keeps unplaced shots visible and keeps existing voice audio with its failure", () => {
  const layout = buildStoryboardMatrixLayout({
    entries,
    timings: [{ stableShotId: "b", startFrame: 0, endFrame: 60 }],
    pixelsPerFrame: 1,
    targetWidth: 60,
  });
  const html = renderToStaticMarkup(
    <StoryboardManuscriptTable
      {...callbacks}
      entries={layout.entries.map(entry => ({
        ...entry,
        shot: { ...entry.shot, voiceAudioUrl: "/old.mp3" },
      }))}
      voiceError={() => "配音失败，原音频保留"}
    />
  );
  expect(html).toContain("甲的台词");
  expect(html).toContain('src="/old.mp3"');
  expect(html).toContain('role="alert"');
});
