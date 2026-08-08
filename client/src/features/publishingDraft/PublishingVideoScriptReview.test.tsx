import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  buildPublishingVideoPreview,
  canonicalizePublishingVideoParagraphs,
} from "@shared/publishingVideoStoryboard";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

import { PublishingVideoScriptReview } from "./PublishingVideoScriptReview";

function findButton(
  element: React.ReactNode,
  label: string
): React.ReactElement<{ disabled?: boolean; onClick?: () => void }> | null {
  if (!React.isValidElement<{ children?: React.ReactNode }>(element)) return null;
  if (
    element.type === "button" &&
    React.Children.toArray(element.props.children).join("") === label
  ) {
    return element as React.ReactElement<{ disabled?: boolean; onClick?: () => void }>;
  }
  for (const child of React.Children.toArray(element.props.children)) {
    const found = findButton(child, label);
    if (found) return found;
  }
  return null;
}

describe("PublishingVideoScriptReview", () => {
  it("shows every source paragraph, rewritten script, and mapped shot before confirmation", () => {
    const paragraphs = canonicalizePublishingVideoParagraphs(
      "第一段正文\n\n请关注后续更新"
    );
    const preview = buildPublishingVideoPreview({
      paragraphs,
      rewrites: paragraphs.map((paragraph, index) => ({
        paragraphId: paragraph.paragraphId,
        scriptText: `可表演的第 ${index + 1} 段`,
        visualTreatment: `第 ${index + 1} 段画面处理`,
      })),
      now: 1,
    });
    const html = renderToStaticMarkup(
      <PublishingVideoScriptReview
        preview={preview}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(html).toContain("剧本预览 · 4 个镜头");
    expect(html).toContain("来源：第一段正文");
    expect(html).toContain("来源：请关注后续更新");
    expect(html).toContain("可表演的第 1 段");
    expect(html).toContain("行动号召 · 转为画面/表演");
    expect(html).toContain("确认写入故事版");
    expect(html).toContain("data-testid=\"publishing-video-script-preview\"");
  });

  it("disables confirmation for stale previews and while a confirmation is pending", () => {
    const paragraphs = canonicalizePublishingVideoParagraphs("一段正文");
    const preview = buildPublishingVideoPreview({
      paragraphs,
      rewrites: paragraphs.map(paragraph => ({
        paragraphId: paragraph.paragraphId,
        scriptText: "转写后的剧本",
        visualTreatment: "保留纸张纤维质感",
      })),
      now: 1,
    });

    const staleHtml = renderToStaticMarkup(
      <PublishingVideoScriptReview
        preview={{ ...preview, status: "stale" }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(staleHtml).toMatch(/确认写入故事版<\/button>/);
    expect(staleHtml).toContain("disabled");

    const confirmingHtml = renderToStaticMarkup(
      <PublishingVideoScriptReview
        preview={preview}
        confirming
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect((confirmingHtml.match(/disabled=""/g) ?? []).length).toBe(2);
  });

  it("forwards cancel and confirm actions, including dismissal through the dialog", () => {
    const preview = buildPublishingVideoPreview({
      paragraphs: canonicalizePublishingVideoParagraphs("一段正文"),
      rewrites: [
        {
          paragraphId: "paragraph-1",
          scriptText: "转写后的剧本",
          visualTreatment: "保留纸张纤维质感",
        },
      ],
      now: 1,
    });
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const dialog = PublishingVideoScriptReview({ preview, onCancel, onConfirm }) as React.ReactElement<{
      onOpenChange: (open: boolean) => void;
    }>;

    dialog.props.onOpenChange(true);
    expect(onCancel).not.toHaveBeenCalled();
    dialog.props.onOpenChange(false);
    expect(onCancel).toHaveBeenCalledTimes(1);

    const cancelButton = findButton(dialog, "先不确认");
    const confirmButton = findButton(dialog, "确认写入故事版");
    expect(cancelButton?.props.disabled).toBe(false);
    expect(confirmButton?.props.disabled).toBe(false);
    cancelButton?.props.onClick?.();
    confirmButton?.props.onClick?.();
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
