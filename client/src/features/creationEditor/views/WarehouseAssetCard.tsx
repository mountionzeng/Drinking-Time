import { Layers3 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";
import type { WarehouseMedia } from "../warehouseShotMedia";

export function WarehouseAssetCard({ item, name, storyId }: { item: WarehouseMedia; name: string; storyId: number }) {
  const { language } = useUiLanguage();
  const en = language === "en";
  const facts = item.assetVersion?.fixedFacts;
  const lines = facts ? Object.entries(facts).filter(([key]) => key !== "kind").flatMap(([,value]) => typeof value === "string" ? [value] : Array.isArray(value) ? value.filter(v => typeof v === "string") : []) : item.artRecipe?.style ?? [];
  return <Popover><PopoverTrigger asChild><button type="button" aria-label={`${en ? "View asset" : "查看资产 / View asset"} · ${name}`} className="block w-[128px] text-left">
    <span className="flex h-[84px] items-center justify-center rounded bg-muted/30">{item.url ? <img src={item.url} alt={name} className="h-full w-full object-contain" loading="lazy" /> : <Layers3 className="size-6 text-muted-foreground" />}</span>
    <span className="line-clamp-2 py-1 text-[10px] leading-4">{name}</span>
  </button></PopoverTrigger><PopoverContent side="top" className="w-72 space-y-2 text-xs">
    <p className="font-medium">{name}</p>
    {item.url && <img src={item.url} alt={name} className="max-h-48 w-full object-contain" />}
    <p className="max-h-40 overflow-y-auto whitespace-pre-wrap">{lines.join("；") || (en ? "Saved asset version" : "已保存的资产版本")}</p>
    {item.artRecipe && <a href={`/api/art-systems/${storyId}/versions/${item.artRecipe.version}/skill`} download className="underline">{en ? "Download Skill" : "下载 Skill / Download"}</a>}
  </PopoverContent></Popover>;
}
