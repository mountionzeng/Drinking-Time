import type { BookModuleImageTask } from '@shared/bookModuleImageTask';
import { useUiText } from '@/features/uiLanguage/UiLanguage';

export const compositionStatus = (task: BookModuleImageTask | null, proposing=false) => proposing || !task ? '待确认'
  : ({preparing:'核对中',accepted:'生成中',unknown:'待核对',failed:'未完成',succeeded:'已生成'})[task.status];

export function compositionTargetLabel(shotNumbers: number[] | undefined, ui: ReturnType<typeof useUiText>) {
  return shotNumbers?.length ? ui('第 {0} 镜', [shotNumbers.map(n => String(n).padStart(2,'0')).join(' / ')]) : ui('书稿图像 · 未关联镜头');
}

export function BookImageCompositionCard({version,status,createdAt,instruction,summary,onOpen,onContinue,disabled=false,shotNumbers}: {
  version:number;status:string;createdAt?:number;instruction:string;summary:string;
  shotNumbers?:number[];
  onOpen():void;onContinue():void;disabled?:boolean;
}) {
  const ui=useUiText();
  const title=`${compositionTargetLabel(shotNumbers,ui)} · ${ui('图像 V{0} · {1}',[version,ui(status)])}`;
  return <article className="my-2 rounded-lg border border-[var(--panel-border)] bg-transparent p-2 text-xs" aria-label={title}>
    <div className="flex items-center justify-between gap-2">
      <strong>{title}</strong>
      <span className="shrink-0 text-[10px] text-muted-foreground">{createdAt ? new Date(createdAt).toLocaleString() : ui('历史记录')}</span>
    </div>
    <p className="mt-1 whitespace-pre-wrap line-clamp-2">{ui(instruction || '根据所选素材创作一张图片')}</p>
    <p className="mt-1 text-muted-foreground line-clamp-2">{ui(summary)}</p>
    <div className="mt-2 flex gap-2">
      <button type="button" className="rounded-md border px-2 py-1 text-xs" onClick={onOpen}>{ui('打开方案与参数')}</button>
      <button type="button" className="rounded-md border px-2 py-1 text-xs disabled:opacity-40" disabled={disabled} onClick={onContinue}>{ui('继续讨论')}</button>
    </div>
  </article>;
}
