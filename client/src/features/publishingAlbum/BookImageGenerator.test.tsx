import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BookImageGenerator } from "./BookImageGenerator";

vi.mock("@/lib/trpc", () => ({
  trpc: {
    storyAgent: {
      generateForMobile: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    useUtils: () => ({
      storyAgent: { storyMaterialState: { invalidate: vi.fn() } },
    }),
  },
}));
(globalThis as any).React = React;

describe("book image generation entry", () => {
  it("keeps a single compact entry and does not generate on render", () => {
    const generate = vi.fn();
    const html = renderToStaticMarkup(
      <BookImageGenerator
        scope="test"
        storyId={1}
        versionId="v1"
        hasAlbum={false}
        title="测试"
        body="正文"
        assets={[]}
        adoptedCoverId={null}
        coverBusy={false}
        onGenerateCover={generate}
      />
    );
    expect(html).toContain("生成图片");
    expect(html).not.toContain("textarea");
    expect(generate).not.toHaveBeenCalled();
  });
});
