import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { WarehouseVideoThumbnail } from "./WarehouseVideoThumbnail";
import { UiLanguageContext } from "@/features/uiLanguage/UiLanguage";
afterEach(() => vi.unstubAllGlobals());
it("keeps portrait/square/wide sources contained in the same compact preview", () => {
  vi.stubGlobal("React", React);
  for (const aspectRatio of ["9:16", "1:1", "16:9"]) {
    const html = renderToStaticMarkup(<WarehouseVideoThumbnail url="/video.mp4" label="Video" ready aspectRatio={aspectRatio} durationSec={14.5} onSelect={() => {}} />);
    expect(html).toContain("object-contain"); expect(html).toContain("h-[84px]"); expect(html).toContain("14.5s");
    expect(html).not.toContain("object-cover"); expect(html).not.toContain("h-56");
  }
});
it("does not present a failed render as a playable video", () => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(<UiLanguageContext.Provider value={{ language: "en", setLanguage: () => {} }}>
    <WarehouseVideoThumbnail url={null} label="Video" ready={false} state="failed" onSelect={() => {}} />
  </UiLanguageContext.Provider>);
  expect(html).toContain("Failed"); expect(html).toContain('disabled=""'); expect(html).not.toContain("<video");
});

it("freezes the clicked source time before the click handler and never renders image operations", () => {
  vi.stubGlobal("React", React);
  const select = vi.fn(); const media = { currentTime: 2.375, readyState: 4, pause: vi.fn() };
  let down!: () => void; let click!: () => void;
  const create = React.createElement;
  const spy = vi.spyOn(React, "createElement").mockImplementation(((type: any, props: any, ...children: any[]) => {
    if (type === "video" && props.preload === "metadata") props.ref.current = media;
    if (type === "button" && props["aria-label"] === "Video") {down=props.onPointerDown;click=props.onClick;}
    return create(type, props, ...children);
  }) as typeof React.createElement);
  try {
    const html = renderToStaticMarkup(<WarehouseVideoThumbnail url="/video.mp4" label="Video" ready onSelect={select} />);
    down(); media.currentTime = 3; click();
    expect(select).toHaveBeenCalledWith(2.375); expect(media.pause).toHaveBeenCalled();
    expect(html).not.toMatch(/封面|插图|controls=/);
  } finally { spy.mockRestore(); }
});
