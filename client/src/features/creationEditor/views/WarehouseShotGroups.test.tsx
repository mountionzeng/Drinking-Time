import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { UiLanguageContext } from "@/features/uiLanguage/UiLanguage";
import {
  WarehouseCompletionNotice,
  WarehouseShotGroups,
} from "./WarehouseShotGroups";
import type { WarehouseShotGroup } from "../warehouseShotMedia";
import type { CreationEditorShot } from "../types";
import type { StoryMaterialState } from "@shared/storyMaterial";

vi.mock("@/lib/trpc", () => ({
  trpc: {
    storyAgent: { chatImageRevisions: { useQuery: () => ({ data: [] }) } },
    timelineMedia: { audioAssetLibrary: { useQuery: () => ({ data: [] }) } },
  },
}));
vi.stubGlobal("React", React);
afterEach(() => vi.restoreAllMocks());

const group: WarehouseShotGroup = {
  id: "a",
  shotCode: "01",
  items: [
    {
      key: "image:1",
      id: 1,
      kind: "image",
      role: "首帧",
      url: "/image/1",
      createdAt: 1,
      version: "V01",
      ready: true,
    },
    {
      key: "video:2",
      id: 2,
      kind: "video",
      role: "视频",
      url: "/video/2",
      createdAt: 2,
      version: "V01",
      durationSec: 8,
      ready: true,
    },
    {
      key: "audio:3",
      id: 3,
      kind: "audio",
      role: "音效",
      url: "/audio/3",
      createdAt: 3,
      version: "V01",
      durationSec: 1.5,
      ready: true,
    },
  ],
};
it("shows a mixed chronological strip with localized names, versions and durations", () => {
  const renderImage = vi.fn((item, _group, name) => (
    <img key={item.key} src={item.url} alt={name} />
  ));
  const html = renderToStaticMarkup(
    <UiLanguageContext.Provider
      value={{ language: "en", setLanguage: vi.fn() }}
    >
      <WarehouseShotGroups
        groups={[group]}
        groupId="a"
        loading={false}
        error={null}
        onSelectVideo={vi.fn()}
        renderImage={renderImage}
      />
    </UiLanguageContext.Provider>
  );
  expect(html).toContain("Shot 01 · First frame V01");
  expect(html).toContain("Shot 01 · Videos V01");
  expect(html).toContain("8.0s");
  expect(html).toContain("1.5s");
  expect(html.indexOf("/image/1")).toBeLessThan(html.indexOf("/video/2"));
  expect(html.indexOf("/video/2")).toBeLessThan(html.indexOf("/audio/3"));
  expect(html).not.toMatch(/按生成|镜头素材|音效/);
});

it("opens the receipt's exact group and describes existing media as saved, not newly rendered", () => {
  const dispatchEvent = vi.fn();
  vi.stubGlobal("window", { dispatchEvent });
  let open: (() => void) | undefined;
  const create = React.createElement;
  vi.spyOn(React, "createElement").mockImplementation(((
    type: any,
    props: any,
    ...children: any[]
  ) => {
    if (type === "button") open = props.onClick;
    return create(type, props, ...children);
  }) as typeof React.createElement);
  const html = renderToStaticMarkup(
    <WarehouseCompletionNotice
      storyId={7}
      shots={[{ stableShotId: "a", shotNo: 1 }] as CreationEditorShot[]}
      materialState={
        {
          storyId: 7,
          shots: [],
          warehouseImages: [
            {
              id: 1,
              storyId: 7,
              shotIdentity: "a",
              imageUrl: "/image/1",
              createdAt: 1,
            },
          ],
        } as unknown as StoryMaterialState
      }
    />
  );
  expect(html).toContain("最近素材：第 01 镜 · 图片 V01，已保存到");
  expect(html).not.toContain("已完成");
  open!();
  expect(dispatchEvent.mock.calls[0][0].detail).toEqual({
    storyId: 7,
    groupId: "a",
  });
});
