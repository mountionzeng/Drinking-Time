import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { StoryMaterialState } from "@shared/storyMaterial";
import type { VisualAssetKind } from "@shared/visualAssets";
import {
  quoteShotImages,
  shotImageRenderSettingsSchema,
  type ShotImageRenderSettings,
  type ShotRenderReferences,
} from "@shared/shotImageRender";

export type RenderReferenceOption = {
  key: string;
  label: string;
  imageUrl: string;
  imageId?: number;
  kind?: VisualAssetKind;
  assetId?: string;
  versionId?: string;
};
export function shotRenderReferenceOptions(
  material: StoryMaterialState
): RenderReferenceOption[] {
  const imageMap = new Map(
    [
      ...material.unassignedImages,
      ...material.shots.flatMap(shot => [
        ...shot.imageVersions,
        ...(shot.relatedImages ?? []),
      ]),
      ...(material.visualAssets?.images ?? []),
    ].map(image => [image.id, image])
  );
  const assets = (material.visualAssets?.assets ?? []).flatMap(asset =>
    asset.versions.flatMap(version => {
      if (
        version.status === "superseded" ||
        (asset.kind !== "pet" && version.status !== "locked")
      )
        return [];
      const role =
        asset.kind === "scene"
          ? "establishing"
          : asset.kind === "style"
            ? "character-sample"
            : "identity-detail";
      const view = version.views.find(view => view.role === role);
      const image = view && imageMap.get(view.imageId);
      return image
        ? [
            {
              key: `asset:${version.id}`,
              label: `${asset.name} · V${asset.versions.indexOf(version) + 1}`,
              imageUrl: image.imageUrl,
              kind: asset.kind,
              assetId: asset.id,
              versionId: version.id,
            },
          ]
        : [];
    })
  );
  const assetImageIds = new Set(
    material.visualAssets?.images.map(image => image.id)
  );
  return [
    ...assets,
    ...Array.from(imageMap.values())
      .filter(image => !assetImageIds.has(image.id))
      .map(image => ({
        key: `image:${image.id}`,
        label: `图片 #${image.id}`,
        imageUrl: image.imageUrl,
        imageId: image.id,
      })),
  ];
}
export function selectedReferenceKeys(refs: ShotRenderReferences): string[] {
  return [
    ...Object.values(refs.assets).map(ref => `asset:${ref.versionId}`),
    ...refs.imageIds.map(id => `image:${id}`),
  ];
}
export function changeRenderReference(
  refs: ShotRenderReferences,
  option: RenderReferenceOption,
  remove: boolean
): ShotRenderReferences {
  if (option.kind) {
    const assets = { ...refs.assets };
    if (remove) delete assets[option.kind];
    else
      assets[option.kind] = {
        assetId: option.assetId!,
        versionId: option.versionId!,
      };
    return { ...refs, assets };
  }
  return {
    ...refs,
    imageIds: remove
      ? refs.imageIds.filter(id => id !== option.imageId)
      : [...new Set([...refs.imageIds, option.imageId!])],
  };
}

export function loadShotRenderSettings(
  storyId: number,
  stableShotId: string,
  material?: StoryMaterialState | null
): ShotImageRenderSettings {
  try {
    const parsed = shotImageRenderSettingsSchema.safeParse(
      JSON.parse(
        localStorage.getItem(`shot-image-render:${storyId}:${stableShotId}`) ??
          "null"
      )
    );
    if (parsed.success) return parsed.data;
  } catch {
    /* No saved preferences. */
  }
  const binding = material?.visualAssets?.bindings.find(
    binding => binding.stableShotId === stableShotId
  );
  const assets = binding
    ? {
        character: binding.character,
        pet: binding.pet,
        scene: binding.scene,
        style: binding.style,
      }
    : material?.visualAssets?.defaultPet
      ? { pet: material.visualAssets.defaultPet }
      : {};
  return {
    count: 1,
    references: {
      imageIds: [],
      assets: Object.fromEntries(
        Object.entries(assets).filter(([, value]) => value)
      ),
    },
  };
}

export function ShotImageRenderControl({
  storyId,
  stableShotId,
  label,
  material,
  disabled,
  busy,
  onRender,
  onSettingsChange,
}: {
  storyId: number;
  stableShotId: string;
  label: string;
  material?: StoryMaterialState | null;
  disabled: boolean;
  busy: boolean;
  onRender: (settings: ShotImageRenderSettings) => Promise<void>;
  onSettingsChange?: () => void;
}) {
  const storageKey = `shot-image-render:${storyId}:${stableShotId}`;
  const [saved, setSaved] = useState<ShotImageRenderSettings | undefined>(
    () => {
      try {
        const parsed = shotImageRenderSettingsSchema.safeParse(
          JSON.parse(localStorage.getItem(storageKey) ?? "null")
        );
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    }
  );
  const [countText, setCountText] = useState(String(saved?.count ?? 1));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const references =
    saved?.references ??
    loadShotRenderSettings(storyId, stableShotId, material).references;
  const options = material ? shotRenderReferenceOptions(material) : [];
  const keys = selectedReferenceKeys(references);
  const chosen = keys.map(key => options.find(option => option.key === key));
  const missing = chosen.some(option => !option);
  const count = Number(countText);
  const validCount = Number.isInteger(count) && count >= 1 && count <= 8;
  const save = (next: ShotRenderReferences, nextCount = count) => {
    const value = {
      count:
        Number.isInteger(nextCount) && nextCount >= 1 && nextCount <= 8
          ? nextCount
          : (saved?.count ?? 1),
      references: next,
    };
    setSaved(value);
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* Editing remains usable without local storage. */
    }
    onSettingsChange?.();
  };
  const toggle = (option: RenderReferenceOption) => {
    const remove = keys.includes(option.key);
    const next = changeRenderReference(references, option, remove);
    if (selectedReferenceKeys(next).length > 4) {
      setError("最多选择 4 个参考素材");
      return;
    }
    setError(null);
    save(next);
  };
  return (
    <div
      className="@container flex w-full flex-col items-start gap-1.5"
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <div
        className="flex flex-wrap items-center gap-1"
        aria-label={`${label} 本次参考素材`}
      >
        {chosen.map((option, index) =>
          option ? (
            <div key={option.key} className="relative">
              <button
                type="button"
                disabled={busy}
                onClick={() => setPickerOpen(true)}
                title={`更换${option.label}`}
                aria-label={`更换${option.label}`}
                className="block rounded-full border border-border p-0.5"
              >
                <img
                  src={option.imageUrl}
                  alt={option.label}
                  className="h-8 w-8 rounded-full object-cover"
                />
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`移除参考 ${option.label}`}
                onClick={() => toggle(option)}
                className="absolute -right-1 -top-1 rounded-full border bg-background p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ) : (
            <span key={keys[index]} className="text-[10px] text-destructive">
              参考已失效
            </span>
          )
        )}
        <button
          type="button"
          disabled={busy || !material}
          aria-label={`${label} 编辑参考素材`}
          onClick={() => setPickerOpen(true)}
          className="flex h-7 items-center gap-1 whitespace-nowrap rounded-full border border-dashed px-1.5 text-[10px] text-muted-foreground"
        >
          <Plus className="h-3 w-3" />
          <span className="hidden @[80px]:inline">{keys.length ? "参考" : "添加参考"}</span>
        </button>
      </div>
      <div className="grid grid-cols-[20px_12px] items-center justify-center rounded-xl border border-primary/30 bg-primary/10 px-1 py-1 text-primary @[80px]:flex @[80px]:rounded-full">
        <button
          type="button"
          disabled={disabled || busy || !material || missing || !validCount}
          aria-label={`渲染 ${label} 的 ${countText} 张图片`}
          onClick={() => {
            setError(null);
            save(references);
            void onRender({ count, references }).catch(cause =>
              setError(cause instanceof Error ? cause.message : "渲染失败")
            );
          }}
          className="col-span-2 flex justify-center whitespace-nowrap px-1 text-[10px] font-medium disabled:opacity-40 @[80px]:col-span-1"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            "渲染"
          )}
        </button>
        <input
          type="number"
          min={1}
          max={8}
          step={1}
          value={countText}
          disabled={busy}
          aria-label={`${label} 渲染张数`}
          onChange={event => {
            setCountText(event.target.value);
            const n = Number(event.target.value);
            if (n >= 1 && n <= 8 && Number.isInteger(n)) save(references, n);
          }}
          className="w-5 appearance-none bg-transparent text-center text-[10px] font-medium outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="text-[10px]">张</span>
      </div>
      <span className="text-[10px] text-muted-foreground">
        {validCount
          ? `预计 ¥${quoteShotImages(count).estimatedCny.toFixed(2)}`
          : "请输入 1–8 的整数"}
        {keys.length === 0 ? " · 不参考素材" : ""}
      </span>
      {error ? (
        <p role="alert" className="max-w-56 text-[10px] text-destructive">
          {error}
        </p>
      ) : null}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{label} · 参考素材</DialogTitle>
            <DialogDescription>
              只使用这里选中的素材，最多 4 个。取消选择不会删除仓库资产。
            </DialogDescription>
          </DialogHeader>
          <button
            type="button"
            className="text-left text-xs text-muted-foreground"
            onClick={() => {
              save({ imageIds: [], assets: {} });
              setError(null);
            }}
          >
            清空参考
          </button>
          <div className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto">
            {options.map(option => (
              <button
                key={option.key}
                type="button"
                aria-pressed={keys.includes(option.key)}
                onClick={() => toggle(option)}
                className={`rounded border p-1 text-[10px] ${keys.includes(option.key) ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <img
                  src={option.imageUrl}
                  alt={option.label}
                  className="aspect-square w-full rounded object-contain"
                />
                <span className="line-clamp-2 break-all" title={option.label}>{option.label}</span>
              </button>
            ))}
          </div>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
