import { Check, ImagePlus, Loader2, Palette, UserRound, Warehouse, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { VisualAssetKind } from "@shared/visualAssets";

export type VisualAssetImageOption = {
  id: number;
  imageUrl: string;
  label: string;
};

export type VisualAssetCreationValue = {
  kind: VisualAssetKind;
  name: string;
  referenceImageIds: number[];
};

const KIND_OPTIONS: Array<{
  kind: VisualAssetKind;
  label: string;
  description: string;
  icon: typeof UserRound;
}> = [
  {
    kind: "character",
    label: "人物",
    description: "锁定脸、发型、服饰和配件",
    icon: UserRound,
  },
  {
    kind: "scene",
    label: "场景",
    description: "锁定空间、材质和固定陈设",
    icon: Warehouse,
  },
  {
    kind: "style",
    label: "美术风格",
    description: "锁定媒介、笔触、造型和色彩语言",
    icon: Palette,
  },
];

export function visualAssetKindLabel(kind: VisualAssetKind): string {
  return KIND_OPTIONS.find(option => option.kind === kind)?.label ?? kind;
}

export default function VisualAssetCreationDialog({
  open,
  images,
  initialKind,
  initialName = "",
  submitLabel = "创建资产草案",
  pending = false,
  onClose,
  onRequestImport,
  onSubmit,
}: {
  open: boolean;
  images: VisualAssetImageOption[];
  initialKind?: VisualAssetKind;
  initialName?: string;
  submitLabel?: string;
  pending?: boolean;
  onClose: () => void;
  onRequestImport?: () => void;
  onSubmit: (value: VisualAssetCreationValue) => void | Promise<void>;
}) {
  const [kind, setKind] = useState<VisualAssetKind | null>(initialKind ?? null);
  const [name, setName] = useState(initialName);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  useEffect(() => {
    if (!open) return;
    setKind(initialKind ?? null);
    setName(initialName);
    setSelectedIds([]);
  }, [initialKind, initialName, open]);

  if (!open) return null;

  const toggleImage = (imageId: number) => {
    setSelectedIds(current =>
      current.includes(imageId)
        ? current.filter(id => id !== imageId)
        : [...current, imageId]
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={initialKind ? `更新${visualAssetKindLabel(initialKind)}资产` : "创建视觉资产"}
    >
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">
              {initialKind ? `建立新的${visualAssetKindLabel(initialKind)}版本` : "创建视觉资产"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              先明确资产类型，再选择同一设计的参考图。AI 不会把人物、场景和画风混在一起分析。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!kind ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {KIND_OPTIONS.map(option => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.kind}
                    type="button"
                    onClick={() => {
                      setKind(option.kind);
                      setName(option.label);
                    }}
                    className="rounded-lg border border-border p-4 text-left transition hover:border-primary/60 hover:bg-primary/5"
                  >
                    <Icon className="h-5 w-5 text-primary" />
                    <div className="mt-3 text-sm font-semibold">{option.label}</div>
                    <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {option.description}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-60 flex-1 text-xs font-medium">
                  资产名称
                  <input
                    value={name}
                    onChange={event => setName(event.currentTarget.value)}
                    maxLength={240}
                    className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                    placeholder={`例如：${visualAssetKindLabel(kind)} 01`}
                  />
                </label>
                {!initialKind ? (
                  <button
                    type="button"
                    onClick={() => setKind(null)}
                    className="h-9 rounded-md border border-border px-3 text-xs text-muted-foreground hover:text-foreground"
                  >
                    重选类型
                  </button>
                ) : null}
                {onRequestImport ? (
                  <button
                    type="button"
                    onClick={onRequestImport}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs hover:border-primary/50 hover:text-primary"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    先导入新图片
                  </button>
                ) : null}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-medium">选择参考图</span>
                  <span className="text-muted-foreground">
                    已选 {selectedIds.length} 张 · 最多 12 张
                  </span>
                </div>
                {images.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                    当前 Story 还没有图片。请先导入参考图。
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {images.map(image => {
                      const selected = selectedIds.includes(image.id);
                      return (
                        <button
                          key={image.id}
                          type="button"
                          onClick={() => toggleImage(image.id)}
                          disabled={!selected && selectedIds.length >= 12}
                          aria-pressed={selected}
                          className={`relative overflow-hidden rounded-md border text-left transition disabled:opacity-40 ${
                            selected
                              ? "border-primary ring-2 ring-primary/25"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          <img
                            src={image.imageUrl}
                            alt={image.label}
                            className="aspect-video w-full bg-muted object-cover"
                          />
                          <span className="block truncate px-2 py-1.5 text-[11px] text-muted-foreground">
                            {image.label}
                          </span>
                          {selected ? (
                            <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                              <Check className="h-3 w-3" />
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {kind ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="h-9 rounded-md border border-border px-3 text-xs"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void onSubmit({ kind, name: name.trim(), referenceImageIds: selectedIds })}
              disabled={pending || !name.trim() || selectedIds.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {submitLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
