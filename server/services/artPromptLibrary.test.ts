import { beforeEach, describe, expect, it } from "vitest";
import { resetMemoryStateForTesting } from "../db";
import { migrateStoryPromptLineage } from "./promptLineageMigration";
import { getStoryPromptProjection } from "./promptLineage";
import {
  bindStoryArtPromptLibraryVersion,
  importUserArtPromptLibrary,
  listArtPromptLibraries,
  syncSystemArtPromptLibraries,
} from "./artPromptLibrary";
import type { StoryPromptAggregate } from "../../shared/promptLineage";

function currentCompilation(
  projection: StoryPromptAggregate,
  stableShotId: string,
  modality: "dialogue" | "image" | "video",
) {
  const head = projection.compilationHeads.find(
    item => item.stableShotId === stableShotId && item.modality === modality,
  );
  return projection.compilations.find(
    item => item.id === head?.currentCompilationId,
  );
}

describe("artPromptLibrary service", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "";
    resetMemoryStateForTesting();
  });

  it("deduplicates identical imports and creates a new version when content changes", async () => {
    const first = await importUserArtPromptLibrary({
      userId: 7,
      name: "写实记录",
      source: "obsidian://styles/documentary",
      items: [
        { dimension: "visual_style", content: "documentary realism" },
        { dimension: "lighting", content: "soft natural light" },
      ],
    });
    const duplicate = await importUserArtPromptLibrary({
      userId: 7,
      name: "写实记录",
      source: "obsidian://styles/documentary",
      items: [
        { dimension: "lighting", content: "soft natural light" },
        { dimension: "visual_style", content: "documentary realism" },
      ],
    });
    const changed = await importUserArtPromptLibrary({
      userId: 7,
      name: "写实记录",
      source: "obsidian://styles/documentary",
      items: [
        { dimension: "visual_style", content: "documentary realism" },
        { dimension: "lighting", content: "golden practical light" },
      ],
    });

    expect(duplicate.version.id).toBe(first.version.id);
    expect(changed.version.version).toBe(first.version.version + 1);
    const listed = await listArtPromptLibraries({ userId: 7 });
    const userLibraries = listed.filter(item => item.library.kind === "user");
    expect(userLibraries.map(item => item.version.id)).toEqual([
      changed.version.id,
      first.version.id,
    ]);
  });

  it("syncs active style entries into reusable system art prompt libraries", async () => {
    const [seeded] = await syncSystemArtPromptLibraries({
      entries: [
        {
          id: "test-documentary",
          name: "测试纪实摄影",
          one_liner: "真实工作现场里的柔和观察",
          status: "active",
          style: ["documentary photography", "cinematic realism"],
          palette: ["warm neutrals", "muted contrast"],
          light: "soft window light",
          composition: "medium shot with breathing room",
          material: "fine film grain",
          era_culture: "contemporary workplace",
          signature: "honest faces held in practical light",
          negative: ["split screen", "collage", "plastic skin"],
          emotion_fit: [],
          theme_fit: [],
          affinity: { age: {}, profession: {}, wuxing: {} },
          references: [],
          notes: "",
        },
      ],
    });

    expect(seeded.library.kind).toBe("system");
    expect(seeded.version.source).toBe("style-library:test-documentary");
    expect(seeded.items.map(item => item.dimension)).toEqual([
      "visual_style",
      "color_palette",
      "lighting",
      "composition",
      "material",
      "negative_prompt",
      "art_style_recipe",
    ]);

    const [duplicate] = await syncSystemArtPromptLibraries({
      entries: [
        {
          id: "test-documentary",
          name: "测试纪实摄影",
          one_liner: "真实工作现场里的柔和观察",
          status: "active",
          style: ["documentary photography", "cinematic realism"],
          palette: ["warm neutrals", "muted contrast"],
          light: "soft window light",
          composition: "medium shot with breathing room",
          material: "fine film grain",
          era_culture: "contemporary workplace",
          signature: "honest faces held in practical light",
          negative: ["split screen", "collage", "plastic skin"],
          emotion_fit: [],
          theme_fit: [],
          affinity: { age: {}, profession: {}, wuxing: {} },
          references: [],
          notes: "",
        },
      ],
    });
    expect(duplicate.version.id).toBe(seeded.version.id);

    const listed = await listArtPromptLibraries({ userId: 7 });
    expect(
      listed.some(
        item =>
          item.library.kind === "system" &&
          item.version.source === "style-library:test-documentary",
      ),
    ).toBe(true);
  });

  it("binds a version to a story and feeds image/video prompt lineage only", async () => {
    await migrateStoryPromptLineage({
      storyId: 88,
      userId: 7,
      body: {
        title: "提示词库故事",
        shots: [
          {
            stableShotId: "shot-01",
            shotNo: 1,
            subject: "主角站在办公室门口",
            dialogue: "我准备好了",
            promptDraft: "one person outside an office door",
            cameraMove: "缓慢推近",
          },
        ],
      },
    });
    const library = await importUserArtPromptLibrary({
      userId: 7,
      name: "温暖广告片",
      source: "obsidian://styles/warm-commercial",
      items: [
        {
          dimension: "visual_style",
          content: "premium commercial film, human-centered realism",
          negativeContent: "split-screen, collage layout",
        },
        { dimension: "color_palette", content: "warm neutrals" },
        { dimension: "material", content: "soft film grain" },
      ],
    });
    const before = await getStoryPromptProjection({ storyId: 88, userId: 7 });
    if (!before) throw new Error("expected migrated story");

    const bound = await bindStoryArtPromptLibraryVersion({
      storyId: 88,
      userId: 7,
      libraryVersionId: library.version.id,
      expectedVersion: before.state.version,
      operationKey: "bind-warm-commercial",
    });

    expect(bound.binding.libraryVersionId).toBe(library.version.id);
    expect(bound.changedDimensions).toEqual([
      "visual_style",
      "color_palette",
      "material",
      "negative_prompt",
    ]);
    const projection = bound.projection;
    if (!projection) throw new Error("expected projection");
    const imageCompilation = currentCompilation(projection, "shot-01", "image");
    const videoCompilation = currentCompilation(projection, "shot-01", "video");
    const dialogueCompilation = currentCompilation(
      projection,
      "shot-01",
      "dialogue",
    );
    expect(imageCompilation?.finalText).toContain(
      "premium commercial film",
    );
    expect(imageCompilation?.finalText).toContain("negative_prompt(22%)");
    expect(videoCompilation?.finalText).toContain("warm neutrals");
    expect(dialogueCompilation?.finalText).not.toContain(
      "premium commercial film",
    );
  });
});
