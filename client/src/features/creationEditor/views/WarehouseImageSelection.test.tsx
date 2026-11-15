import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { toggleWarehouseImage, WarehouseImageSelection } from "./WarehouseImageSelection";
vi.stubGlobal("React", React);
const image = (id: number) => ({ id, imageUrl: `/image/${id}`, label: `Image ${id}` });
describe("warehouse image selection", () => {
  it("preserves click order, deselects without duplicates, and enforces its limit", () => {
    let selected = [image(9), image(3)];
    selected = toggleWarehouseImage(selected, image(7));
    expect(selected.map(i=>i.id)).toEqual([9,3,7]);
    selected = toggleWarehouseImage(selected, image(3));
    expect(selected.map(i=>i.id)).toEqual([9,7]);
    for (const id of [4,5,6,8]) selected = toggleWarehouseImage(selected, image(id));
    expect(selected.map(i=>i.id)).toEqual([9,7,4,5,6]);
  });
  it("exposes an ordered checkbox without image adoption or edit actions", () => {
    const html = renderToStaticMarkup(<WarehouseImageSelection image={image(7)} order={2} onToggle={vi.fn()} />);
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('选择图片 7');
    expect(html).not.toContain('设为首帧');
  });
});
