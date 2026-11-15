import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatComputeQuote } from '@shared/computeMoney';
import { requestsStrictReferenceFidelity, type ShotRenderReferences } from '@shared/shotImageRender';
import type { StoryMaterialState } from '@shared/storyMaterial';
import { InlineImagePrompt, type InlineImagePromptHandle } from './InlineImagePrompt';
import { compileImageDraft, composerImages, initialImagePrompt, type ComposerImage, type ImageGenerationDraft } from './imageGenerationDraft';
import { shotImageContinuityNotice } from './shotImageContinuityNotice';

export type ImageGenerationComposerRequest = {
  label: string; instruction: string; references: ShotRenderReferences;
  material: StoryMaterialState; estimatedCny: number; language: string;
};
export function ImageGenerationComposer({ request, onResolve }: {
  request: ImageGenerationComposerRequest;
  onResolve: (draft: ImageGenerationDraft | null) => void;
}) {
  const zh = request.language.startsWith('zh');
  const t = (cn: string, en: string) => zh ? cn : en;
  const [images] = useState(() => composerImages(request.material, request.language));
  const [document, setDocument] = useState(() => initialImagePrompt(request.instruction, request.references));
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState('');
  const [preview, setPreview] = useState<{ image: ComposerImage; anchor?: DOMRect } | null>(null);
  const [dimensions, setDimensions] = useState('');
  const editor = useRef<InlineImagePromptHandle>(null);
  const resolved = useRef(false);
  let draft: ImageGenerationDraft | undefined;
  let error = '';
  try { draft = compileImageDraft(document, images, request.references); }
  catch (cause) {
    const code = cause instanceof Error ? cause.message : '';
    error = code === 'empty-prompt' ? t('请填写生成描述。', 'Describe the image you want to generate.')
      : code === 'reference-limit' ? t('最多使用 4 张参考图片，请删除多余的图片标签。', 'Use up to 4 references. Remove extra image chips.')
      : code === 'duplicate-asset-kind' ? t('同一类素材只能使用一个版本，请删除多余的标签。', 'Use only one version of each asset type.')
      : code === 'prompt-limit' ? t('描述过长，请缩短至 2000 字以内。', 'Keep the description under 2,000 characters.')
      : t('部分参考已失效，请删除对应标签后重新选择。', 'A reference is unavailable. Remove its chip and choose again.');
  }
  const refs = draft?.references;
  const count = refs ? refs.imageIds.length + Object.keys(refs.assets).length : 0;
  const notice = refs ? shotImageContinuityNotice(request.material, refs, request.language) : '';
  const settle = (value: ImageGenerationDraft | null) => {
    if (resolved.current) return;
    resolved.current = true;
    onResolve(value);
  };
  const showPreview = (image: ComposerImage | null, anchor?: DOMRect) => { setDimensions(''); setPreview(image ? { image, anchor } : null); };
  const visible = images.filter(image => `${image.label} ${image.image?.prompt ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const style = request.material.filmStyleReference;
  return <Dialog open onOpenChange={open => { if (!open) settle(null); }}>
    <DialogContent onOpenAutoFocus={event => { event.preventDefault(); editor.current?.focus(); }} className="z-[160] max-h-[92dvh] overflow-hidden sm:max-w-5xl flex flex-col gap-5 bg-background">
      <DialogHeader>
        <DialogTitle>{t('编辑生成描述', 'Edit image description')} <span className="ml-2 text-sm font-normal text-muted-foreground">{request.label}</span></DialogTitle>
        <DialogDescription>{t('修改文字，或点击仓库图片插入引用。悬停图片标签可查看详情。', 'Edit the text or click a library image to insert it. Hover over an image chip for details.')}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px] min-h-0 overflow-y-auto">
        <section className="min-w-0 space-y-3">
          <div className="flex items-center justify-between text-sm"><label className="font-medium">{t('生成描述', 'Image description')}</label><span className="text-xs text-muted-foreground">{count}/4 {t('张参考', 'references')}</span></div>
          <InlineImagePrompt ref={editor} initialValue={document} images={images} label={t('生成描述', 'Image description')} onChange={value => { setDocument(value); setFeedback(''); }} onPreview={showPreview} />
          <p className="text-xs text-muted-foreground">{t('选中图片标签后可按删除键移除；本次修改只用于这次生成。', 'Select a chip and press Delete to remove it. These edits apply to this generation only.')}</p>
          {style?.image && <div className="flex items-center gap-3 rounded-md bg-muted/60 p-3">
            <button type="button" className="shrink-0 rounded focus-visible:ring-2 focus-visible:ring-primary" onMouseEnter={event => showPreview({ key: `image:${style.imageId}`, label: style.name, imageUrl: style.image!.imageUrl, image: style.image! }, event.currentTarget.getBoundingClientRect())} onMouseLeave={() => showPreview(null)} onFocus={event => showPreview({ key: `image:${style.imageId}`, label: style.name, imageUrl: style.image!.imageUrl, image: style.image! }, event.currentTarget.getBoundingClientRect())} onBlur={() => showPreview(null)} aria-label={t('查看全片画风参考', 'View film style reference')}><img src={style.image.imageUrl} alt="" className="h-12 w-16 rounded object-cover" /></button>
            <div className="text-xs leading-5"><p className="font-medium">{t('全片画风参考', 'Film style reference')} · V{style.version}</p><p className="text-muted-foreground">{t('独立保留笔触、色彩和材质；可在对话中更换或停用。', 'Keeps drawing style, colors and textures. Change or disable it in chat.')}</p></div>
          </div>}
          {notice && <p className="text-xs leading-5 whitespace-pre-line text-muted-foreground">{notice}</p>}
          {draft && requestsStrictReferenceFidelity(draft.instruction) && count > 0 && <p className="text-xs text-amber-700">{t('MJ 会重绘参考图，细节不保证完全一致；请检查候选再采用。', 'MJ redraws references, so details may change. Review candidates before adopting.')}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <p role="status" className="text-xs text-muted-foreground min-h-4">{feedback}</p>
        </section>
        <aside className="min-w-0 border-t pt-4 md:border-t-0 md:border-l md:pl-5 md:pt-0">
          <h3 className="text-sm font-medium">{t('仓库 · 图片', 'Library · Images')} <span className="font-normal text-muted-foreground">{images.length}</span></h3>
          <input aria-label={t('搜索仓库图片', 'Search library images')} placeholder={t('搜索镜头、编号或描述', 'Search shot, ID or description')} value={search} onChange={event => setSearch(event.target.value)} className="my-3 w-full rounded-md border bg-background px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-primary/30" />
          <div className="grid grid-cols-3 gap-2 md:grid-cols-2 max-h-72 md:max-h-[49vh] overflow-y-auto pr-1">
            {visible.map(image => <button key={image.key} type="button" aria-label={`${t('插入', 'Insert')} ${image.label}`} className="group overflow-hidden rounded-md border text-left transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-primary" onMouseDown={event => event.preventDefault()} onClick={() => { editor.current?.insert(image); setFeedback(t(`已插入 ${image.label}`, `Inserted ${image.label}`)); showPreview(null); }} onMouseEnter={event => showPreview(image, event.currentTarget.getBoundingClientRect())} onMouseLeave={() => showPreview(null)} onFocus={event => showPreview(image, event.currentTarget.getBoundingClientRect())} onBlur={() => showPreview(null)}>
              <img src={image.imageUrl} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover bg-muted" />
              <span className="block truncate px-2 py-1.5 text-[11px]">{image.label}</span>
            </button>)}
          </div>
          {!visible.length && <p className="py-8 text-center text-xs text-muted-foreground">{t(images.length ? '没有匹配的图片' : '仓库暂时没有图片，可直接用文字生成', images.length ? 'No matching images' : 'No images yet. You can generate from text.')}</p>}
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{t('点击图片，插入到描述的光标位置。重复引用同一张图只占一个名额。', 'Click to insert at the cursor. Reusing an image counts as one reference.')}</p>
        </aside>
      </div>
      <DialogFooter className="items-center border-t pt-4 sm:justify-between shrink-0">
        <p className="text-sm mr-auto">{t('生成 4 张候选 · 预计 ', '4 candidates · Estimated ')}<strong>{zh ? formatComputeQuote(request.estimatedCny) : formatComputeQuote(request.estimatedCny).replace('算力', ' credits')}</strong><span className="block text-xs text-muted-foreground mt-1">{t('最终以实际扣费为准；候选不会自动替换原图。', 'Final cost follows actual usage. Candidates do not replace the original.')}</span></p>
        <div className="flex gap-2"><button type="button" className="rounded-md border px-4 py-2 text-sm" onClick={() => settle(null)}>{t('取消', 'Cancel')}</button>
          <button type="button" disabled={!draft} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-40" onClick={() => { try { settle(compileImageDraft(editor.current!.read(), images, request.references)); } catch { /* validation is shown beside the editor */ } }}>{t('确认费用并生成', 'Confirm cost & generate')}</button></div>
      </DialogFooter>
    </DialogContent>
    {preview && typeof window !== 'undefined' && createPortal(<div role="tooltip" className="fixed z-[200] pointer-events-none w-64 rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl" style={{ left: Math.min(Math.max(8, (preview.anchor?.left ?? 20) - 100), window.innerWidth - 272), top: Math.max(8, Math.min((preview.anchor?.bottom ?? 20) + 8, window.innerHeight - 340)) }}>
      <img key={preview.image.key} src={preview.image.imageUrl} alt={preview.image.label} className="h-40 w-full rounded object-contain bg-muted" onLoad={event => setDimensions(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)} />
      <p className="mt-2 text-sm font-medium">{preview.image.label}</p><p className="text-xs text-muted-foreground">{dimensions}{preview.image.image?.createdAt ? ` · ${new Date(preview.image.image.createdAt).toLocaleDateString(zh ? 'zh-CN' : 'en-US')}` : ''}</p>
      {preview.image.image?.prompt && <p className="mt-2 line-clamp-4 text-xs leading-5">{preview.image.image.prompt}</p>}
    </div>, window.document.body)}
  </Dialog>;
}
