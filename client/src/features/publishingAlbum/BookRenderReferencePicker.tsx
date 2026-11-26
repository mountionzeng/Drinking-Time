import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { bookReferenceIntent, type BookReferenceSource, type BookRenderReference } from "@shared/bookRenderReference";

type Scope = { storyId: number; chapterId: number; moduleId: string };
type Role = BookRenderReference["use"];
export function useBookRenderReference(scope: Scope, enabled: boolean, instruction: string) {
  const hint = bookReferenceIntent(instruction);
  const [manual, setManual] = useState<string | null>(null);
  const [id, setId] = useState("");
  const [role, setRole] = useState<Role>();
  const [consent, setConsent] = useState("");
  const value = manual ?? String(hint?.source ?? "none");
  const source: BookReferenceSource | undefined = value === "above" || value === "previous" ? value :
    /^\d{1,4}$/.test(value) && Number(value) > 0 ? Number(value) : undefined;
  const use = role ?? hint?.use ?? "continuity";
  const query = trpc.storyAgent.bookModuleReferenceImages.useQuery({ ...scope, source: source ?? "above" },
    { enabled: enabled && source !== undefined, retry: false, refetchOnMount: "always" });
  const choices = enabled && source !== undefined ? query.data ?? [] : [];
  const selected = choices.find(c => c.fingerprint === id) ??
    (choices.length === 1 && choices[0].kind !== "candidate" ? choices[0] : undefined);
  const consentKey = selected ? selected.fingerprint + ":" + use : "";
  const pending = enabled && source !== undefined && query.isFetching;
  const confirmed = Boolean(selected && consent === consentKey);
  const reference: BookRenderReference | undefined = enabled && source !== undefined && selected ? {
    source, imageId: selected.imageId, fingerprint: selected.fingerprint, use, sendThumbnail: selected.needsCopy && confirmed, allowPublicHosting: selected.needsCopy && confirmed ? true : undefined,
  } : undefined;
  const blocked = enabled && value !== "none" && (!reference || pending || query.isError || Boolean(selected?.needsCopy && !confirmed));
  return { value, source, use, choices, selected, pending, error: query.error?.message, confirmed, reference, blocked,
    chooseSource(next: string) { setManual(next); setId(""); setRole(undefined); setConsent(""); },
    chooseImage(next: string) { setId(next); setConsent(""); },
    chooseRole(next: Role) { setRole(next); setConsent(""); },
    allow(checked: boolean) { setConsent(checked ? consentKey : ""); } };
}

export function BookRenderReferencePicker({ model: m, disabled }: { model: ReturnType<typeof useBookRenderReference>; disabled: boolean }) {
  const ui = useUiText();
  const numbered = !["none", "above", "previous"].includes(m.value);
  return <fieldset disabled={disabled} className="space-y-2 rounded border p-2 text-sm">
    <legend>{ui("镜头参考图")}</legend>
    <select aria-label={ui("参考图来源")} value={numbered ? "number" : m.value}
      onChange={e => m.chooseSource(e.target.value === "number" ? "" : e.target.value)}>
      <option value="none">{ui("不使用镜头参考图")}</option><option value="number">{ui("指定镜号")}</option>
      <option value="previous">{ui("上一镜")}</option><option value="above">{ui("书页上方最近的图")}</option>
    </select>
    {numbered && <label>{ui("参考第几镜")} <input aria-label={ui("参考镜号")} className="w-16 border" inputMode="numeric"
      maxLength={4} value={m.value} onChange={e => m.chooseSource(e.target.value)} /></label>}
    {m.value !== "none" && <>
      {m.pending ? <p role="status">{ui("正在书页和仓库定位图片…")}</p> : m.error ? <p role="alert">{m.error}</p> :
        !m.choices.length && <p>{ui(m.source === undefined ? "请输入镜号。" : "没有找到这个位置可用的图片，请核对镜号或更换来源。")}</p>}
      {m.choices.length > 0 && <div className="flex flex-wrap gap-2">{m.choices.map(c =>
        <label key={c.fingerprint} className="inline-flex items-center gap-1"><input type="radio" name="book-reference-image"
          checked={m.selected?.fingerprint === c.fingerprint} onChange={() => m.chooseImage(c.fingerprint)} />
          <img src={c.imageUrl} alt="" className="h-12 w-16 rounded object-contain" />
          {c.shotNo ? ui("第 {0} 镜", [String(c.shotNo).padStart(2,"0")]) : ui("上图")} · #{c.imageId} · {ui(c.kind === "page" ? "书页插图" : c.kind === "selected" ? "已采用" : "仓库候选")}
        </label>)}</div>}
      {m.selected && <label>{ui("参考用途")} <select aria-label={ui("参考用途")} value={m.use} onChange={e => m.chooseRole(e.target.value as Role)}>
        <option value="continuity">{ui("延续同一场景和人物")}</option>
        <option value="scene">{ui("参考画面内容和构图")}</option><option value="style">{ui("仅参考色调和画风")}</option>
      </select></label>}
      {m.selected && m.use === "continuity" && <p className="text-xs text-muted-foreground">{ui("沿用图中可见的建筑、人物和天气。机位、动作或光线按本镜要求调整。")}</p>}
      {m.selected?.needsCopy && <label className="block"><input type="checkbox" checked={m.confirmed} onChange={e => m.allow(e.target.checked)} />
        {" "}{ui("允许本轮将 #{0} 的缩图上传至 OSS 或 302，供图片服务读取。持有链接的人也可查看缩图。", [m.selected.imageId])}</label>}
    </>}
  </fieldset>;
}
