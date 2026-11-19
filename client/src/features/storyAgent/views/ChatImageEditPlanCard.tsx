import { imageEditPlanQuote, type ChatImageEditPlan } from '@shared/chatImageEditPlan';
import { imageEditGenerationError } from '../imageEditPurchase';
import { ChatImageReferenceChip } from './ChatImageReferenceChip';
import { formatComputeQuote } from '@shared/computeMoney';
import type { ReactNode } from 'react';

export function ChatImageEditPlanCard({ plan, disabled, onChange, onSubmit, onQuote, batch }: {
  plan: ChatImageEditPlan;
  disabled?: boolean;
  onChange: (plan: ChatImageEditPlan) => void;
  onSubmit: () => void;
  onQuote?: (imageId: number, copy: number) => void;
  batch?: ReactNode;
}) {
  const submitted = plan.status === 'submitted';
  const error = imageEditGenerationError(plan);
  const quote = imageEditPlanQuote(plan);
  const count = quote.candidates;
  const updateImage = (id: number, patch: Partial<ChatImageEditPlan['images'][number]>) =>
    onChange({ ...plan, images: plan.images.map(image => image.imageId === id ? { ...image, ...patch } : image) });
  const inputClass = 'min-w-0 rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground';
  const rowsFor = (text: string, minimum = 1) => Math.min(5, Math.max(minimum, Math.ceil(text.length / 20)));
  if (submitted) return <section aria-label="已确认的改图要求" className="mt-2 space-y-1 text-xs">
    {batch ?? <><p>已记录：{plan.mode === 'separate' ? '分别修改' : '合成'}，共 {count} 张候选。</p>
    <p>预计合计 {formatComputeQuote(quote.totalCny)}。逐张确认费用后生成，当前没有提交生成。</p>
    <div className="flex flex-wrap gap-1.5">{plan.images.filter(image => image.role === 'target' && plan.renderRoute !== 'storyboard').flatMap(image => Array.from({ length: image.copies }, (_, index) =>
      <button key={`${image.imageId}:${index}`} type="button" disabled={disabled || !onQuote}
        className="rounded border px-2 py-1 disabled:opacity-40" onClick={() => onQuote?.(image.imageId, index + 1)}>
        #{image.imageId} · 第{index + 1}张报价
      </button>))}</div></>}
    <button type="button" disabled={disabled} className="underline disabled:opacity-40"
      onClick={() => onChange({ ...plan, status: 'draft' })}>调整要求</button>
  </section>;
  return <form aria-label="确认图片修改要求" className="mt-2 space-y-2 text-xs" onSubmit={event => { event.preventDefault(); if (!disabled && !error) onSubmit(); }}>
    <fieldset disabled={disabled} className="min-w-0 space-y-2 disabled:opacity-60">
      <label className="flex items-center gap-2">怎么生成
        <select aria-label="生成方式" value={plan.mode} className={`${inputClass} flex-1`}
          onChange={event => onChange({ ...plan, mode: event.target.value as ChatImageEditPlan['mode'] })}>
          <option value="separate">每张原图分别修改</option><option value="compose">按一张底图合成</option>
        </select>
      </label>
      {plan.images.map(image => <div key={image.imageId} className="space-y-1 rounded border border-border/60 p-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <ChatImageReferenceChip imageId={image.imageId} imageUrl={image.imageUrl} />
          <select aria-label={`图片 #${image.imageId} 的用途`} className={`${inputClass} flex-1`} value={image.role}
            onChange={event => updateImage(image.imageId, { role: event.target.value as typeof image.role })}>
            <option value="undecided">请选择用途</option><option value="target">{plan.mode === 'separate' ? '修改' : '底图'}</option>
            <option value="reference">参考</option><option value="omit">不用</option>
          </select>
          {image.role === 'target' && plan.renderRoute !== 'storyboard' && <select aria-label={`图片 #${image.imageId} 生成张数`} value={image.copies} className={inputClass}
            onChange={event => updateImage(image.imageId, { copies: Number(event.target.value) })}>
            {[1, 2, 3, 4].map(count => <option key={count} value={count}>{count} 张</option>)}
          </select>}
        </div>
        {image.role !== 'omit' && <textarea aria-label={`图片 #${image.imageId} 的修改或参考说明`} value={image.purpose} maxLength={1000} rows={rowsFor(image.purpose)}
          placeholder={image.role === 'reference' ? '参考什么？如暗部层次、通透程度、配色' : '这张图的具体修改或参考方式（可补充）'}
          className={`${inputClass} block w-full resize-y`} onChange={event => updateImage(image.imageId, { purpose: event.target.value })} />}
      </div>)}
      <label className="block">要改哪里<textarea aria-label="要改哪里" value={plan.changes} maxLength={2000} rows={rowsFor(plan.changes, 2)}
        className={`${inputClass} mt-1 block w-full resize-y`} onChange={event => onChange({ ...plan, changes: event.target.value })} /></label>
      <label className="block">哪些必须保留<textarea aria-label="哪些必须保留" value={plan.preserve} maxLength={1000} rows={rowsFor(plan.preserve)}
        placeholder="如飞机的大小、位置、数量、形状和颜色" className={`${inputClass} mt-1 block w-full resize-y`}
        onChange={event => onChange({ ...plan, preserve: event.target.value })} /></label>
      <label className="block">层次、配色及其他要求<textarea aria-label="层次、配色及其他要求" value={plan.details} maxLength={1000} rows={rowsFor(plan.details, 2)}
        placeholder="如保留暗部层次，提高通透度；也可注明不需要其他调整" className={`${inputClass} mt-1 block w-full resize-y`}
        onChange={event => onChange({ ...plan, details: event.target.value })} /></label>
      <fieldset className="flex flex-wrap gap-x-3 gap-y-1"><legend>出图流程</legend>
        {(['precision', 'storyboard'] as const).map(route => {
          const price = formatComputeQuote(imageEditPlanQuote({ ...plan, renderRoute: route }).unitCny);
          return <label key={route} className="inline-flex items-center gap-1">
            <input type="radio" name="image-render-route" checked={(plan.renderRoute ?? 'precision') === route}
              onChange={() => onChange({ ...plan, renderRoute: route })} />
            {route === 'precision' ? `原图精修 · ${price}/张` : `省算力（分镜 MJ）· ${price}/4 张`}
          </label>;
        })}
      </fieldset>
      <p>共 {count} 张新候选 · 预计合计 {formatComputeQuote(quote.totalCny)}</p>
      {error && <p role="status" className="text-muted-foreground">{error}</p>}
      <button type="submit" disabled={Boolean(error)} className="rounded bg-primary px-2 py-1.5 text-primary-foreground disabled:opacity-40">确认并生成 {count} 张</button>
      <p className="text-muted-foreground">点击即确认以上要求和预计费用；结果进入仓库，不替换剪辑。实际扣费以结算回执为准。</p>
    </fieldset>
  </form>;
}
