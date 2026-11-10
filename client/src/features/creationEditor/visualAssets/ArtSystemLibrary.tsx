import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { activeArtSystemRecipe } from "@shared/artSystem";
import type { StoryArtDirection } from "@shared/artDirection";

export function ArtSystemDetails({ storyId, direction, images = [] }: {
  storyId: number;
  direction: StoryArtDirection;
  images?: { id: number; imageUrl: string }[];
}) {
  const ui = useUiText();
  const [selected, setSelected] = useState<number | null>(null);
  const versions = [...new Map([...direction.recipeVersions, ...(direction.recipe ? [direction.recipe] : [])]
    .filter(recipe => recipe.system).map(recipe => [recipe.version, recipe])).values()].sort((a, b) => b.version - a.version);
  const recipe = versions.find(item => item.version === selected) ?? versions[0];
  if (!recipe?.system) return <p className="mb-3 text-xs text-muted-foreground">{ui("在对话中描述想要的美术体系，规则、参考图和 Skill 会保存在这里。")}</p>;
  const system = recipe.system;
  const active = activeArtSystemRecipe({ artDirection: direction });
  const references = images.filter(image => system.referenceImageIds.includes(image.id));
  const sections = [
    [ui("风格"), recipe.style], [ui("色彩"), recipe.palette], [ui("光线"), recipe.light],
    [ui("构图"), recipe.composition], [ui("材质"), recipe.material], [ui("物体规则"), system.objectRules],
    [ui("运动规则"), system.motionRules], [ui("连续性"), system.continuityRules], [ui("避免"), recipe.negative],
  ] as const;
  return <section className="mb-4 space-y-2 border-b border-border pb-4" aria-label={ui("美术体系")}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-medium">{ui("美术体系")}</h3>
      <select aria-label={ui("美术体系版本")} className="max-w-full rounded border border-border bg-background px-2 py-1 text-xs"
        value={recipe.version} onChange={event => setSelected(Number(event.target.value))}>
        {versions.map(item => <option key={item.version} value={item.version}>V{String(item.version).padStart(2, "0")} · {ui(item.system?.confirmedAt ? "已确认" : "待确认")}</option>)}
      </select>
    </div>
    <p className="text-sm">{system.name}</p>
    <p className="text-xs text-muted-foreground">{active ? ui("制作使用 V{0}", [String(active.version).padStart(2, "0")]) : ui("确认后用于制作")}</p>
    <p className="text-xs text-muted-foreground">{system.editorName || ui("未知编辑者")} · {new Date(recipe.updatedAt).toLocaleString()}</p>
    <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{recipe.style.join("；")}</p>
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">{ui("规则与修改记录")}</summary>
      <p className="my-2 whitespace-pre-wrap text-muted-foreground">{ui("修改意图")}：{system.intent}</p>
      <dl className="space-y-1 leading-relaxed">{sections.filter(([, lines]) => lines.length).map(([title, lines]) =>
        <div key={title}><dt className="inline font-medium">{title}：</dt><dd className="inline text-muted-foreground">{lines.join("；")}</dd></div>)}</dl>
    </details>
    {references.length > 0 && <div className="flex flex-wrap gap-2">{references.map(image =>
      <a key={image.id} href={image.imageUrl} target="_blank" rel="noreferrer" title={`${ui("参考图")} #${image.id}`}>
        <img src={image.imageUrl} alt={`${ui("参考图")} #${image.id}`} className="h-16 w-20 rounded bg-muted object-contain" />
        <span className="text-[10px] text-muted-foreground">#{image.id}{system.confirmedImageId === image.id ? ` · ${ui("基准图")}` : ""}</span>
      </a>)}</div>}
    <a className="inline-block text-xs underline underline-offset-4" download={`art-system-v${recipe.version}-SKILL.md`}
      href={`/api/art-systems/${storyId}/versions/${recipe.version}/skill`}>{ui("下载 Skill")}</a>
    <p className="text-[11px] text-muted-foreground">{ui("继续在对话中修改或确认；这里只查看版本。")}</p>
  </section>;
}

export default function ArtSystemLibrary({ storyId, images }: { storyId: number | null; images?: { id: number; imageUrl: string }[] }) {
  const ui = useUiText();
  const query = trpc.artSystems.read.useQuery({ storyId: storyId ?? 0 }, { enabled: Boolean(storyId && storyId > 0) });
  if (!storyId) return null;
  if (query.error) return <p className="text-xs text-destructive">{ui("美术体系暂未载入，请稍后重试")}</p>;
  if (!query.data) return <p className="text-xs text-muted-foreground">{ui("正在读取美术体系…")}</p>;
  return <ArtSystemDetails key={storyId} storyId={storyId} direction={query.data} images={images} />;
}
