import { expect, it } from "vitest";
import { bookReferenceIntent } from "./bookRenderReference";

it.each([
  ["参考02镜的图", 2, "continuity"], ["沿用02的色调，可以偏亮一点点", 2, "style"],
  ["参考 01 镜，改为参考第 02 镜的配色", 2, "style"], ["参照上一个镜头", "previous", "continuity"],
  ["参考上面的图", "above", "continuity"], ["参考02镜的图，只要色调", 2, "style"],
  ["参考02镜的构图和色调", 2, "scene"],
  ["参考02镜，不只参考色调，建筑和人物保持一致", 2, "continuity"],
  ["只参考02镜的色调。人物和建筑也要保持一致", 2, "continuity"],
  ["参考02镜，建筑保持一致。改主意了，只借色调", 2, "style"],
  ["沿用02的色调，可以偏亮一点点，是城墙里面的视角", 2, "continuity"],
  ["参考02镜，建筑、人物和天气都要一样，只把画面调亮", 2, "continuity"],
  ["参考02镜的图。只借它的画风。", 2, "style"],
  ["只参考第02镜的配色，换到另一座建筑", 2, "style"],
  ["参考02镜的图，天气改晴，仍是原来的建筑和人物", 2, "continuity"],
  ["沿用02的色调。\n人物和天气跟原图保持一致", 2, "continuity"],
])("recognizes %s", (text, source, use) => {
  expect(bookReferenceIntent(String(text))).toEqual({ source, use });
});
it.each(["第02镜有一束光", "不要参考02镜的图", "参考02镜。不要参考上图"])("does not silently select a reference for %s", text => {
  expect(bookReferenceIntent(text)).toBeUndefined();
});
