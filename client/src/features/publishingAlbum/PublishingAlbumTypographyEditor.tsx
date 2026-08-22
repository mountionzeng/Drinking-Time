import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Check, Redo2, Type, Undo2 } from "lucide-react";

import type { PublishingAlbumTypographyLayout } from "../../../../shared/publishingAlbum";
import {
  installedPublishingAlbumFonts,
  publishingAlbumFontById,
} from "../../../../shared/publishingAlbumFonts";
import {
  classifyPublishingAlbumStroke,
  type PublishingAlbumCanonicalGeometry,
  type PublishingAlbumStrokePoint,
} from "./publishingAlbumGeometry";
import { PublishingAlbumFontRepository } from "./publishingAlbumFontRepository";
import {
  recommendPublishingAlbumFonts,
  resolvePublishingAlbumFontChoice,
  type PublishingAlbumFontRecommendation,
} from "./publishingAlbumFontRecommendation";
import {
  buildPublishingAlbumLayout,
  type PublishingAlbumFontMetrics,
  type PublishingAlbumLayoutPlan,
} from "./publishingAlbumLayout";
import { PublishingAlbumPagePreview } from "./PublishingAlbumPagePreview";

const fontRepository = new PublishingAlbumFontRepository();
const EMPTY_ART_DIRECTION_TAGS: readonly string[] = Object.freeze([]);

export function resolvePublishingAlbumTypographyArtDirectionTags(
  tags?: readonly string[]
): readonly string[] {
  return tags ?? EMPTY_ART_DIRECTION_TAGS;
}

function initialGeometry(
  layout: PublishingAlbumTypographyLayout | null
): PublishingAlbumCanonicalGeometry | null {
  if (!layout) return null;
  if (layout.kind === "path") return { kind: "path", points: layout.points };
  const { x, y, width, height } = layout.region;
  return {
    kind: "region",
    shape: layout.shape,
    direction: layout.direction,
    region: layout.region,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

function canvasMetrics(
  fontId: string,
  fontReady: boolean,
  glyphsReady: boolean
): PublishingAlbumFontMetrics {
  return {
    isLoaded: candidate => candidate === fontId && fontReady,
    supportsText: candidate => candidate === fontId && glyphsReady,
    measure: (grapheme, candidate, fontSize) => {
      if (typeof document === "undefined") return fontSize;
      const context = document.createElement("canvas").getContext("2d");
      if (!context) return fontSize;
      const family = publishingAlbumFontById(candidate)?.family ?? "sans-serif";
      context.font = `${fontSize}px "${family}"`;
      return context.measureText(grapheme).width || fontSize;
    },
  };
}

export function PublishingAlbumTypographyEditor({
  text,
  backgroundUrl,
  initialLayout,
  artDirectionTags,
  saving = false,
  saveBlocked = false,
  canvas = { width: 900, height: 1200 },
  backgroundStyle,
  editorLabel = "画册文字排版编辑器",
  saveLabel = "保存",
  saveSuccessMessage = "排版已保存",
  onSave,
}: {
  text: string;
  backgroundUrl: string | null;
  initialLayout: PublishingAlbumTypographyLayout | null;
  artDirectionTags?: readonly string[];
  saving?: boolean;
  saveBlocked?: boolean;
  canvas?: { width: number; height: number };
  backgroundStyle?: CSSProperties;
  editorLabel?: string;
  saveLabel?: string;
  saveSuccessMessage?: string;
  onSave(layout: PublishingAlbumTypographyLayout): Promise<void> | void;
}) {
  const resolvedArtDirectionTags =
    resolvePublishingAlbumTypographyArtDirectionTags(artDirectionTags);
  const savedGeometry = useMemo(
    () => initialGeometry(initialLayout),
    [initialLayout]
  );
  const [geometry, setGeometry] =
    useState<PublishingAlbumCanonicalGeometry | null>(savedGeometry);
  const [history, setHistory] = useState<
    Array<PublishingAlbumCanonicalGeometry | null>
  >([]);
  const [drawing, setDrawing] = useState(false);
  const [stroke, setStroke] = useState<PublishingAlbumStrokePoint[]>([]);
  const [fontId, setFontId] = useState(
    initialLayout?.fontId ?? "noto-serif-sc"
  );
  const [alignment, setAlignment] = useState<"start" | "center" | "end">(
    initialLayout?.alignment ?? "center"
  );
  const [fontSize, setFontSize] = useState<number | null>(
    initialLayout?.fontSize ?? null
  );
  const [letterSpacing, setLetterSpacing] = useState(
    initialLayout?.letterSpacing ?? 0
  );
  const [lineSpacing, setLineSpacing] = useState(
    initialLayout?.lineSpacing ?? 1.3
  );
  const [fontReady, setFontReady] = useState(false);
  const [glyphsReady, setGlyphsReady] = useState(false);
  const [recommendations, setRecommendations] = useState<
    PublishingAlbumFontRecommendation[]
  >([]);
  const [message, setMessage] = useState("双击画面或点击“排版文字”开始");
  const drawingRef = useRef(false);
  const strokeRef = useRef<PublishingAlbumStrokePoint[]>([]);
  const userSelectedFontRef = useRef(Boolean(initialLayout?.fontId));

  useEffect(() => {
    setGeometry(savedGeometry);
    setHistory([]);
    setFontId(initialLayout?.fontId ?? "noto-serif-sc");
    setAlignment(initialLayout?.alignment ?? "center");
    setFontSize(initialLayout?.fontSize ?? null);
    setLetterSpacing(initialLayout?.letterSpacing ?? 0);
    setLineSpacing(initialLayout?.lineSpacing ?? 1.3);
    setDrawing(false);
    setStroke([]);
    strokeRef.current = [];
    userSelectedFontRef.current = Boolean(initialLayout?.fontId);
  }, [initialLayout, savedGeometry, text]);

  useEffect(() => {
    let active = true;
    void recommendPublishingAlbumFonts({
      text,
      role: geometry?.kind === "path" ? "path" : "body",
      artDirectionTags: resolvedArtDirectionTags,
      repository: fontRepository,
    })
      .then(result => {
        if (!active) return;
        setRecommendations(result);
        if (!initialLayout?.fontId && !userSelectedFontRef.current) {
          setFontId(
            resolvePublishingAlbumFontChoice({
              savedFontId: null,
              recommendations: result,
            })
          );
        }
      })
      .catch(() => {
        if (active) setRecommendations([]);
      });
    return () => {
      active = false;
    };
  }, [geometry?.kind, initialLayout?.fontId, resolvedArtDirectionTags, text]);

  useEffect(() => {
    let active = true;
    setFontReady(false);
    setGlyphsReady(false);
    void fontRepository
      .load(fontId)
      .then(async () => {
        const missing = await fontRepository.missingCharacters(fontId, text);
        if (!active) return;
        setFontReady(true);
        setGlyphsReady(missing.length === 0);
        if (missing.length > 0)
          setMessage(
            `所选字体缺少：${missing.slice(0, 8).join("")}，请换一种字体`
          );
      })
      .catch(() => {
        if (active) setMessage("字体加载失败，请重试或换一种字体");
      });
    return () => {
      active = false;
    };
  }, [fontId, text]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !drawingRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      drawingRef.current = false;
      setDrawing(false);
      setStroke([]);
      strokeRef.current = [];
      setMessage("已退出绘制，未保存的排版仍然保留");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const layoutResult = useMemo(
    () =>
      geometry
        ? buildPublishingAlbumLayout({
            text,
            fontId,
            geometry,
            canvas,
            alignment,
            fontSize: fontSize ?? undefined,
            letterSpacing,
            lineSpacing,
            metrics: canvasMetrics(fontId, fontReady, glyphsReady),
          })
        : null,
    [
      alignment,
      canvas,
      fontId,
      fontReady,
      fontSize,
      geometry,
      glyphsReady,
      letterSpacing,
      lineSpacing,
      text,
    ]
  );
  const plan: PublishingAlbumLayoutPlan | null =
    layoutResult?.status === "ok" ? layoutResult.plan : null;

  const beginDrawing = () => {
    setDrawing(true);
    setStroke([]);
    strokeRef.current = [];
    setMessage("请在画面上画一笔：闭合为区域，开放为路径");
  };
  const pointFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const finishStroke = (
    event: React.PointerEvent<HTMLDivElement>,
    cancelled = false
  ) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const bounds = event.currentTarget.getBoundingClientRect();
    const points = cancelled
      ? strokeRef.current
      : [...strokeRef.current, pointFromEvent(event)];
    const result = classifyPublishingAlbumStroke({
      points,
      width: bounds.width,
      height: bounds.height,
      cancelled,
    });
    setStroke([]);
    strokeRef.current = [];
    if (result.status !== "ok") {
      setMessage(
        cancelled
          ? "绘制已取消，没有保存"
          : "这笔无法形成排版，请画得更长、更清楚一些"
      );
      return;
    }
    setHistory(current => [...current, geometry]);
    setGeometry(result.geometry);
    setMessage(
      result.geometry.kind === "region"
        ? "已识别为文字区域"
        : "已识别为文字路径"
    );
  };

  const save = async () => {
    if (!geometry || !plan) return;
    const base = {
      layoutVersion: 1 as const,
      fontId,
      alignment,
      fontSize: plan.fontSize,
      letterSpacing: plan.letterSpacing,
      lineSpacing: plan.lineSpacing,
      contrast: plan.contrast,
    };
    await onSave(
      geometry.kind === "path"
        ? { ...base, kind: "path", points: geometry.points }
        : {
            ...base,
            kind: "region",
            shape: geometry.shape,
            direction: geometry.direction,
            region: geometry.region,
          }
    );
    setMessage(saveSuccessMessage);
  };

  return (
    <section className="space-y-3" aria-label={editorLabel}>
      <div className="relative mx-auto max-w-md">
        <PublishingAlbumPagePreview
          backgroundUrl={backgroundUrl}
          plan={plan}
          canvas={canvas}
          backgroundStyle={backgroundStyle}
          label="双击进入画册文字排版"
          onDoubleClick={beginDrawing}
        />
        {drawing ? (
          <div
            className="absolute inset-0 touch-none cursor-crosshair rounded-xl ring-2 ring-[var(--nayin-accent)]"
            role="application"
            aria-label="在图片上绘制文字区域或路径"
            onPointerDown={event => {
              event.currentTarget.setPointerCapture(event.pointerId);
              drawingRef.current = true;
              const point = pointFromEvent(event);
              strokeRef.current = [point];
              setStroke([point]);
            }}
            onPointerMove={event => {
              if (!drawingRef.current) return;
              const point = pointFromEvent(event);
              strokeRef.current = [...strokeRef.current, point];
              setStroke(strokeRef.current);
            }}
            onPointerUp={event => finishStroke(event)}
            onPointerCancel={event => finishStroke(event, true)}
            onBlur={() => {
              if (!drawingRef.current) return;
              drawingRef.current = false;
              setStroke([]);
              strokeRef.current = [];
              setMessage("绘制失去焦点，未提交这笔操作");
            }}
            tabIndex={0}
          >
            <svg className="h-full w-full" aria-hidden="true">
              <polyline
                points={stroke.map(point => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke="var(--nayin-accent)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        ) : null}
      </div>

      <div className="grid gap-2 rounded-xl border border-[var(--panel-border)] bg-background/70 p-2.5">
        <label className="grid grid-cols-[54px_1fr_44px] items-center gap-2 text-[11px]">
          <span className="font-medium text-foreground">字号</span>
          <input
            type="range"
            min={8}
            max={180}
            step={1}
            value={fontSize ?? plan?.fontSize ?? 48}
            disabled={!geometry}
            onChange={event => setFontSize(Number(event.target.value))}
            className="h-1.5 w-full accent-[var(--nayin-accent)] disabled:opacity-40"
            aria-label="字号"
          />
          <span className="text-right font-mono text-[10px] text-muted-foreground">
            {Math.round(fontSize ?? plan?.fontSize ?? 48)}px
          </span>
        </label>
        <label className="grid grid-cols-[54px_1fr_44px] items-center gap-2 text-[11px]">
          <span className="font-medium text-foreground">字间距</span>
          <input
            type="range"
            min={-5}
            max={20}
            step={1}
            value={letterSpacing}
            disabled={!geometry}
            onChange={event => setLetterSpacing(Number(event.target.value))}
            className="h-1.5 w-full accent-[var(--nayin-accent)] disabled:opacity-40"
            aria-label="字间距"
          />
          <span className="text-right font-mono text-[10px] text-muted-foreground">
            {letterSpacing > 0 ? "+" : ""}{letterSpacing}px
          </span>
        </label>
      </div>

      <div
        className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--panel-border)] bg-background/70 p-2"
        aria-label="文字排版工具栏"
      >
        <button
          type="button"
          onClick={beginDrawing}
          className="rounded-lg px-3 py-2 text-xs hover:bg-muted"
        >
          <Type className="mr-1 inline h-4 w-4" />
          排版文字
        </button>
        <button
          type="button"
          onClick={() => {
            const previous = history.at(-1);
            if (previous === undefined) return;
            setGeometry(previous);
            setHistory(current => current.slice(0, -1));
            setMessage("已撤销上一次绘制");
          }}
          disabled={history.length === 0}
          className="rounded-lg px-3 py-2 text-xs hover:bg-muted disabled:opacity-40"
        >
          <Undo2 className="mr-1 inline h-4 w-4" />
          撤销
        </button>
        <button
          type="button"
          onClick={beginDrawing}
          className="rounded-lg px-3 py-2 text-xs hover:bg-muted"
        >
          <Redo2 className="mr-1 inline h-4 w-4" />
          重画
        </button>
        <label className="text-xs">
          <span className="sr-only">字体</span>
          <select
            value={fontId}
            onChange={event => {
              userSelectedFontRef.current = true;
              setFontId(event.target.value);
            }}
            className="rounded-lg border border-[var(--panel-border)] bg-background px-2 py-2"
          >
            {installedPublishingAlbumFonts().map(font => (
              <option key={font.fontId} value={font.fontId}>
                {recommendations.some(item => item.fontId === font.fontId)
                  ? "推荐 · "
                  : ""}
                {font.nameZh}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="sr-only">对齐</span>
          <select
            value={alignment}
            onChange={event =>
              setAlignment(event.target.value as typeof alignment)
            }
            className="rounded-lg border border-[var(--panel-border)] bg-background px-2 py-2"
          >
            <option value="start">起点对齐</option>
            <option value="center">居中</option>
            <option value="end">终点对齐</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!plan || saving || saveBlocked}
          className="ml-auto rounded-lg bg-[var(--nayin-accent)] px-3 py-2 text-xs font-medium text-[var(--background)] disabled:opacity-40"
        >
          <Check className="mr-1 inline h-4 w-4" />
          {saving ? "保存中…" : saveLabel}
        </button>
      </div>
      {recommendations.length > 0 ? (
        <ul
          className="grid gap-1 text-[11px] text-muted-foreground"
          aria-label="为这页推荐的字体"
        >
          {recommendations.map(item => (
            <li key={item.fontId}>
              <strong>{publishingAlbumFontById(item.fontId)?.nameZh}</strong>：
              {item.reason}
            </li>
          ))}
        </ul>
      ) : null}
      <p
        className="text-xs text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {saveBlocked
          ? "请先保存这一页文字，再保存与这份文字对应的排版"
          : layoutResult?.status === "overflow"
            ? layoutResult.suggestion
            : message}
      </p>
    </section>
  );
}
