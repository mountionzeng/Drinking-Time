import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";

export type WarehouseSelectedImage = {id: number; imageUrl: string; label: string};
export const MAX_WAREHOUSE_VIDEO_IMAGES = 5;

export function toggleWarehouseImage(selected: readonly WarehouseSelectedImage[], image: WarehouseSelectedImage) {
  if (selected.some(item => item.id === image.id)) return selected.filter(item => item.id !== image.id);
  if (!image.imageUrl || selected.length >= MAX_WAREHOUSE_VIDEO_IMAGES) return [...selected];
  return [...selected, image];
}

export function WarehouseImageSelection({image, order, onToggle}: {
  image: WarehouseSelectedImage; order: number; onToggle: () => void;
}) {
  const {language} = useUiLanguage();
  return <article className="relative flex w-[84px] shrink-0 flex-col rounded-md bg-background">
    <button type="button" role="checkbox" aria-checked={order > 0}
      aria-label={language === "en" ? `Select image ${image.id}` : `选择图片 ${image.id} / Select image ${image.id}`}
      onClick={onToggle} disabled={!image.imageUrl}
      className={`relative h-[84px] w-full overflow-hidden rounded-md bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${order > 0 ? "ring-2 ring-inset ring-primary" : ""}`}>
      <img src={image.imageUrl} alt={image.label} loading="lazy" className="h-full w-full object-contain" />
      <span aria-hidden className={`absolute right-1 top-1 flex size-5 items-center justify-center rounded-full border text-[10px] ${order > 0 ? "border-primary bg-primary text-primary-foreground" : "border-white bg-black/20"}`}>{order || ""}</span>
    </button>
    <p className="line-clamp-2 py-1 text-[10px] leading-4">{image.label}</p>
  </article>;
}
