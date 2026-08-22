import type {
  PublishingAlbumContrastStyle,
  PublishingAlbumPoint,
} from "../../../../shared/publishingAlbum";
import { publishingAlbumFontById } from "../../../../shared/publishingAlbumFonts";
import type { PublishingAlbumCanonicalGeometry } from "./publishingAlbumGeometry";
import { publishingAlbumSvgPath } from "./publishingAlbumGeometry";

export type PublishingAlbumFontMetrics = {
  isLoaded(fontId: string): boolean;
  supportsText(fontId: string, text: string): boolean;
  measure(grapheme: string, fontId: string, fontSize: number): number;
};

export type PublishingAlbumBackgroundSampler = (x: number, y: number) => {
  r: number; g: number; b: number;
};

export type PublishingAlbumPositionedGrapheme = {
  grapheme: string;
  index: number;
  x: number;
  y: number;
  rotation: number;
};

export type PublishingAlbumLayoutPlan = {
  kind: "region" | "path";
  text: string;
  fontId: string;
  fontFamily: string;
  fontSize: number;
  letterSpacing: number;
  lineSpacing: number;
  alignment: "start" | "center" | "end";
  graphemes: PublishingAlbumPositionedGrapheme[];
  contrast: PublishingAlbumContrastStyle;
  svgPath: string | null;
};

export type PublishingAlbumLayoutResult =
  | { status: "ok"; plan: PublishingAlbumLayoutPlan }
  | {
      status: "overflow" | "invalid";
      reason: "text_does_not_fit" | "unknown_font" | "font_not_loaded" | "missing_glyphs" | "empty_text";
      suggestion: string;
    };

const MIN_FONT_SIZE = 18;
const MAX_FONT_SIZE = 96;

export function publishingAlbumGraphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (
    locales?: string | string[], options?: { granularity: "grapheme" }
  ) => { segment(value: string): Iterable<{ segment: string }> } }).Segmenter;
  if (!Segmenter) return Array.from(text);
  return Array.from(new Segmenter("zh-CN", { granularity: "grapheme" }).segment(text), item => item.segment);
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (value: number) => {
    const normalized = Math.max(0, Math.min(255, value)) / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(left: number, right: number): number {
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

export function publishingAlbumContrastForPoints(
  points: Array<{ x: number; y: number }>,
  sampler?: PublishingAlbumBackgroundSampler
): PublishingAlbumContrastStyle {
  if (!sampler || points.length === 0) {
    return { textColor: "#ffffff", outlineColor: "#000000", outlineWidth: 1.5, backdropColor: null };
  }
  const luminances = points.map(point => relativeLuminance(sampler(point.x, point.y)));
  const whiteWorst = Math.min(...luminances.map(value => contrastRatio(1, value)));
  const blackWorst = Math.min(...luminances.map(value => contrastRatio(0, value)));
  const useWhite = whiteWorst >= blackWorst;
  const worst = useWhite ? whiteWorst : blackWorst;
  return {
    textColor: useWhite ? "#ffffff" : "#000000",
    outlineColor: worst < 4.5 ? (useWhite ? "#000000" : "#ffffff") : null,
    outlineWidth: worst < 4.5 ? 1.5 : 0,
    backdropColor: worst < 3 ? (useWhite ? "rgba(0,0,0,0.24)" : "rgba(255,255,255,0.24)") : null,
  };
}

function alignOffset(alignment: "start" | "center" | "end", available: number, used: number): number {
  return alignment === "center" ? (available - used) / 2 : alignment === "end" ? available - used : 0;
}

function layoutHorizontal(input: {
  graphemes: string[]; fontId: string; fontSize: number;
  x: number; y: number; width: number; height: number;
  alignment: "start" | "center" | "end"; metrics: PublishingAlbumFontMetrics;
  letterSpacing: number; lineSpacing: number;
}): PublishingAlbumPositionedGrapheme[] | null {
  const paddingX = input.width * 0.055;
  const paddingY = input.height * 0.055;
  const availableWidth = input.width - paddingX * 2;
  const availableHeight = input.height - paddingY * 2;
  const lineHeight = input.fontSize * input.lineSpacing;
  const lines: Array<Array<{ grapheme: string; index: number; width: number }>> = [[]];
  let lineWidth = 0;
  input.graphemes.forEach((grapheme, index) => {
    if (grapheme === "\n") { lines.push([]); lineWidth = 0; return; }
    const width = input.metrics.measure(grapheme, input.fontId, input.fontSize);
    if (width > availableWidth) { lines.push([{ grapheme, index, width }]); lineWidth = width; return; }
    const spacedWidth = lines.at(-1)!.length > 0
      ? width + input.letterSpacing
      : width;
    if (lineWidth + spacedWidth > availableWidth && lines.at(-1)!.length > 0) {
      lines.push([]); lineWidth = 0;
    }
    lines.at(-1)!.push({ grapheme, index, width });
    lineWidth += lineWidth > 0 ? width + input.letterSpacing : width;
  });
  if (lines.some(line =>
    line.reduce((sum, item) => sum + item.width, 0) +
      Math.max(0, line.length - 1) * input.letterSpacing > availableWidth
  )) return null;
  const usedHeight = lines.length * lineHeight;
  if (usedHeight > availableHeight) return null;
  const top = input.y + paddingY + (availableHeight - usedHeight) / 2;
  return lines.flatMap((line, lineIndex) => {
    const usedWidth = line.reduce((sum, item) => sum + item.width, 0) +
      Math.max(0, line.length - 1) * input.letterSpacing;
    let cursor = input.x + paddingX + alignOffset(input.alignment, availableWidth, usedWidth);
    return line.map(item => {
      const glyph = {
        grapheme: item.grapheme, index: item.index,
        x: rounded(cursor + item.width / 2),
        y: rounded(top + lineIndex * lineHeight + input.fontSize), rotation: 0,
      };
      cursor += item.width + input.letterSpacing;
      return glyph;
    });
  });
}

function layoutVertical(input: {
  graphemes: string[]; fontSize: number; x: number; y: number; width: number; height: number;
  alignment: "start" | "center" | "end";
}): PublishingAlbumPositionedGrapheme[] | null {
  const paddingX = input.width * 0.055;
  const paddingY = input.height * 0.055;
  const availableWidth = input.width - paddingX * 2;
  const availableHeight = input.height - paddingY * 2;
  const advanceY = input.fontSize * 1.18;
  const advanceX = input.fontSize * 1.12;
  const columns: Array<Array<{ grapheme: string; index: number }>> = [[]];
  input.graphemes.forEach((grapheme, index) => {
    if (grapheme === "\n") { columns.push([]); return; }
    if ((columns.at(-1)!.length + 1) * advanceY > availableHeight) columns.push([]);
    columns.at(-1)!.push({ grapheme, index });
  });
  if (columns.length * advanceX > availableWidth || columns.some(column => column.length === 0)) return null;
  const right = input.x + input.width - paddingX - (availableWidth - columns.length * advanceX) / 2;
  return columns.flatMap((column, columnIndex) => {
    const usedHeight = column.length * advanceY;
    const top = input.y + paddingY + alignOffset(input.alignment, availableHeight, usedHeight);
    return column.map((item, rowIndex) => ({
      grapheme: item.grapheme, index: item.index,
      x: rounded(right - columnIndex * advanceX - advanceX / 2),
      y: rounded(top + rowIndex * advanceY + input.fontSize),
      rotation: 0,
    }));
  });
}

function pointAlongPath(points: Array<{ x: number; y: number }>, distance: number) {
  let remaining = distance;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const segment = Math.hypot(end.x - start.x, end.y - start.y);
    if (remaining <= segment || index === points.length - 1) {
      const ratio = segment === 0 ? 0 : Math.min(1, remaining / segment);
      return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
        rotation: Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI,
      };
    }
    remaining -= segment;
  }
  return { ...points.at(-1)!, rotation: 0 };
}

function layoutPath(input: {
  graphemes: string[]; points: PublishingAlbumPoint[]; width: number; height: number;
  fontId: string; fontSize: number; alignment: "start" | "center" | "end";
  metrics: PublishingAlbumFontMetrics; letterSpacing: number;
}): PublishingAlbumPositionedGrapheme[] | null {
  const points = input.points.map(point => ({ x: point.x * input.width, y: point.y * input.height }));
  const length = points.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y), 0
  );
  const spacing = input.fontSize * 0.04 + input.letterSpacing;
  const widths = input.graphemes.map(grapheme => grapheme === "\n" ? 0 : input.metrics.measure(grapheme, input.fontId, input.fontSize));
  const used = widths.reduce((sum, value) => sum + value, 0) + Math.max(0, widths.length - 1) * spacing;
  if (used > length) return null;
  let cursor = alignOffset(input.alignment, length, used);
  return input.graphemes.map((grapheme, index) => {
    const width = widths[index]!;
    const point = pointAlongPath(points, cursor + width / 2);
    cursor += width + spacing;
    return {
      grapheme, index, x: rounded(point.x), y: rounded(point.y), rotation: rounded(point.rotation),
    };
  });
}

export function buildPublishingAlbumLayout(input: {
  text: string;
  fontId: string;
  geometry: PublishingAlbumCanonicalGeometry;
  canvas: { width: number; height: number };
  alignment?: "start" | "center" | "end";
  fontSize?: number;
  letterSpacing?: number;
  lineSpacing?: number;
  metrics: PublishingAlbumFontMetrics;
  sampleBackground?: PublishingAlbumBackgroundSampler;
}): PublishingAlbumLayoutResult {
  const font = publishingAlbumFontById(input.fontId);
  if (!font?.installed) return { status: "invalid", reason: "unknown_font", suggestion: "请选择字体仓库中已安装的字体" };
  if (!input.metrics.isLoaded(input.fontId)) return { status: "invalid", reason: "font_not_loaded", suggestion: "等待所选字体加载完成后再保存" };
  if (!input.text) return { status: "invalid", reason: "empty_text", suggestion: "请先填写这一页的文字" };
  if (!input.metrics.supportsText(input.fontId, input.text)) return { status: "invalid", reason: "missing_glyphs", suggestion: "所选字体缺少部分字形，请换用兼容字体" };
  const graphemes = publishingAlbumGraphemes(input.text);
  const alignment = input.alignment ?? "center";
  const requestedFontSize =
    typeof input.fontSize === "number" && Number.isFinite(input.fontSize)
      ? Math.min(240, Math.max(8, input.fontSize))
      : null;
  const letterSpacing =
    typeof input.letterSpacing === "number" && Number.isFinite(input.letterSpacing)
      ? Math.min(20, Math.max(-5, input.letterSpacing))
      : 0;
  const lineSpacing =
    typeof input.lineSpacing === "number" && Number.isFinite(input.lineSpacing)
      ? Math.min(3, Math.max(0.8, input.lineSpacing))
      : 1.3;
  let positioned: PublishingAlbumPositionedGrapheme[] | null = null;
  let fontSize = requestedFontSize ?? MAX_FONT_SIZE;
  const minimumFontSize = requestedFontSize ?? MIN_FONT_SIZE;
  for (; fontSize >= minimumFontSize; fontSize -= 1) {
    if (input.geometry.kind === "region") {
      const region = {
        x: input.geometry.region.x * input.canvas.width,
        y: input.geometry.region.y * input.canvas.height,
        width: input.geometry.region.width * input.canvas.width,
        height: input.geometry.region.height * input.canvas.height,
      };
      positioned = input.geometry.direction === "vertical"
        ? layoutVertical({ ...region, graphemes, fontSize, alignment })
        : layoutHorizontal({
            ...region,
            graphemes,
            fontId: input.fontId,
            fontSize,
            alignment,
            metrics: input.metrics,
            letterSpacing,
            lineSpacing,
          });
    } else {
      positioned = layoutPath({
        graphemes, points: input.geometry.points, width: input.canvas.width, height: input.canvas.height,
        fontId: input.fontId,
        fontSize,
        alignment,
        metrics: input.metrics,
        letterSpacing,
      });
    }
    if (positioned) break;
  }
  if (!positioned) return {
    status: "overflow", reason: "text_does_not_fit",
    suggestion: input.geometry.kind === "region" ? "文字在可读字号下放不完，请重画更大的区域" : "路径长度不足，请重画更长的路径",
  };
  return {
    status: "ok",
    plan: {
      kind: input.geometry.kind,
      text: input.text,
      fontId: input.fontId,
      fontFamily: font.family,
      fontSize,
      letterSpacing,
      lineSpacing,
      alignment,
      graphemes: positioned,
      contrast: publishingAlbumContrastForPoints(positioned, input.sampleBackground),
      svgPath: input.geometry.kind === "path"
        ? publishingAlbumSvgPath(input.geometry.points, input.canvas.width, input.canvas.height)
        : null,
    },
  };
}
