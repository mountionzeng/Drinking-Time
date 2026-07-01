import { useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  Link2,
  Loader2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type {
  ArtPromptLibraryImportDraft,
  ArtPromptLibraryItemDraft,
} from "@shared/artPromptLibrary";

type LibraryVersionView = {
  library: {
    id: number;
    kind: "system" | "user";
    name: string;
    description: string | null;
  };
  version: {
    id: number;
    version: number;
    source: string | null;
  };
  items: Array<{
    dimension: string;
    content: string;
    negativeContent: string | null;
  }>;
};

type ArtPromptLibraryPanelProps = {
  versions: LibraryVersionView[];
  currentLibraryVersionId: number | null;
  loading?: boolean;
  disabled?: boolean;
  error?: string | null;
  pendingVersionId?: number | null;
  onImport: (draft: ArtPromptLibraryImportDraft) => Promise<void>;
  onBind: (libraryVersionId: number) => Promise<void>;
};

const dimensionLabels: Record<string, string> = {
  visual_style: "风格",
  color_palette: "色彩",
  lighting: "光线",
  composition: "构图",
  material: "材质",
  negative_prompt: "避免",
  character_reference: "人物",
  scene_reference: "场景",
  art_style_recipe: "配方",
};

function normalizeImportPayload(value: unknown): ArtPromptLibraryImportDraft {
  if (!value || typeof value !== "object") {
    throw new Error("请粘贴一个 JSON 对象。");
  }
  const record = value as Record<string, unknown>;
  const items = Array.isArray(record.items) ? record.items : [];
  return {
    name: typeof record.name === "string" ? record.name : "",
    description:
      typeof record.description === "string" ? record.description : null,
    source: typeof record.source === "string" ? record.source : null,
    items: items.map(item => {
      const itemRecord =
        item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        dimension: itemRecord.dimension,
        content: typeof itemRecord.content === "string" ? itemRecord.content : "",
        negativeContent:
          typeof itemRecord.negativeContent === "string"
            ? itemRecord.negativeContent
            : null,
      } as ArtPromptLibraryItemDraft;
    }),
  };
}

function compactItems(version: LibraryVersionView): string[] {
  return version.items
    .slice()
    .sort((left, right) => left.dimension.localeCompare(right.dimension))
    .slice(0, 4)
    .map(item => dimensionLabels[item.dimension] ?? item.dimension);
}

export default function ArtPromptLibraryPanel({
  versions,
  currentLibraryVersionId,
  loading = false,
  disabled = false,
  error = null,
  pendingVersionId = null,
  onImport,
  onBind,
}: ArtPromptLibraryPanelProps) {
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const currentVersion = useMemo(
    () =>
      versions.find(version => version.version.id === currentLibraryVersionId) ??
      null,
    [currentLibraryVersionId, versions],
  );

  async function handleImport() {
    setLocalError(null);
    setImporting(true);
    try {
      const parsed = normalizeImportPayload(JSON.parse(importText));
      await onImport(parsed);
      setImportText("");
      setImportOpen(false);
    } catch (importError) {
      setLocalError(
        importError instanceof Error ? importError.message : "导入失败",
      );
    } finally {
      setImporting(false);
    }
  }

  async function handleBind(libraryVersionId: number) {
    setLocalError(null);
    try {
      await onBind(libraryVersionId);
    } catch (bindError) {
      setLocalError(
        bindError instanceof Error ? bindError.message : "绑定失败",
      );
    }
  }

  return (
    <section
      className="mb-3 rounded-md border border-border/70 bg-muted/20 px-3 py-3"
      aria-label="美术提示词库"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-foreground">
              美术提示词库
            </h3>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {currentVersion
                ? `${currentVersion.library.name} · v${currentVersion.version.version}`
                : "未绑定库版本"}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setLocalError(null);
            setImportOpen(open => !open);
          }}
          disabled={disabled}
          className="h-7 px-2 text-xs"
        >
          <Upload className="h-3.5 w-3.5" />
          导入
        </Button>
      </div>

      {error || localError ? (
        <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {localError ?? error}
        </div>
      ) : null}

      {importOpen ? (
        <div className="mt-3 space-y-2">
          <Textarea
            value={importText}
            onChange={event => setImportText(event.currentTarget.value)}
            placeholder='{"name":"写实记录","source":"obsidian://...","items":[{"dimension":"visual_style","content":"documentary realism"}]}'
            className="min-h-24 text-xs"
            disabled={disabled || importing}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={() => void handleImport()}
              disabled={disabled || importing || !importText.trim()}
              className="h-7 px-2 text-xs"
            >
              {importing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              保存为新版本
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {loading ? (
          <div className="flex h-16 min-w-48 items-center justify-center rounded-md border border-border bg-background/60 text-xs text-muted-foreground">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            读取中
          </div>
        ) : versions.length === 0 ? (
          <div className="flex h-16 min-w-48 items-center justify-center rounded-md border border-dashed border-border bg-background/40 px-3 text-center text-xs text-muted-foreground">
            暂无库版本。先导入一份美术提示词 JSON。
          </div>
        ) : (
          versions.map(version => {
            const selected = version.version.id === currentLibraryVersionId;
            const pending = pendingVersionId === version.version.id;
            return (
              <article
                key={version.version.id}
                className={`min-w-52 shrink-0 rounded-md border bg-background px-3 py-2 transition-colors ${
                  selected
                    ? "border-primary/70 shadow-sm"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-foreground">
                      {version.library.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      v{version.version.version} ·{" "}
                      {version.library.kind === "system" ? "系统" : "私有"}
                    </div>
                  </div>
                  {selected ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      <Check className="h-3 w-3" />
                      当前
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {compactItems(version).map(label => (
                    <span
                      key={label}
                      className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {label}
                    </span>
                  ))}
                </div>
                <Button
                  type="button"
                  variant={selected ? "secondary" : "outline"}
                  size="sm"
                  disabled={disabled || selected || pending}
                  onClick={() => void handleBind(version.version.id)}
                  className="mt-3 h-7 w-full px-2 text-xs"
                >
                  {pending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" />
                  )}
                  {selected ? "已绑定" : "绑定到故事"}
                </Button>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
