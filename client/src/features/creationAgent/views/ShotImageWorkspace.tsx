import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  History,
  ImageIcon,
  Link2,
  Loader2,
  RefreshCw,
  Sparkles,
  Wand2,
} from 'lucide-react';
import type { ImageAsset } from '@shared/imageAsset';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { buildImageAssetWorkspace } from '../imageAssetViewModel';

type WorkspaceShot = {
  shotNo: string;
  sceneNo?: string;
  sourceSummary?: string | null;
  mood?: string | null;
  promptDraft?: string | null;
};

type ShotImageWorkspaceProps = {
  shots: WorkspaceShot[];
  assets: ImageAsset[];
  focusShotNo: string | null;
  onFocusShot: (shotNo: string) => void;
  onSelectImage: (imageId: number) => Promise<void>;
  onReassignImage: (imageId: number, shotNo: string) => Promise<void>;
  /** 单图循环（U2）：画出来 / 再来一张 */
  onGenerateNext?: (args: { shotNo: string; prompt: string; rejectImageId?: number }) => Promise<void>;
  /** 正在为哪个镜头出图 → 显示生成中骨架 */
  generatingShotNo?: string | null;
  /** 出图失败信息（按镜头）→ inline 错误 + 重试 */
  generateError?: { shotNo: string; message: string } | null;
};

/** 焦点镜头的出图提示词：优先 promptDraft，退而求其次用素材摘要 / 镜号。 */
function resolveShotPrompt(shot: WorkspaceShot | undefined, shotNo: string): string {
  return (
    shot?.promptDraft?.trim() ||
    shot?.sourceSummary?.trim() ||
    `${shotNo} keyframe`
  );
}

const STATUS_LABEL: Record<ImageAsset['status'], string> = {
  selected: '已收下',
  pending: '待确认',
  rejected: '已淘汰',
};

function AssetImage({
  asset,
  className,
}: {
  asset: ImageAsset;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const missing = asset.availability === 'missing' || failed;
  if (missing) {
    return (
      <div className={cn('flex h-full w-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground', className)}>
        <AlertTriangle className="h-6 w-6" />
        <span className="text-xs">文件缺失</span>
      </div>
    );
  }
  return (
    <img
      src={asset.imageUrl}
      alt={asset.prompt || `${asset.canonicalShotNo ?? '待归属'} 图片`}
      className={cn('h-full w-full object-cover', className)}
      onError={() => setFailed(true)}
    />
  );
}

function statusClasses(asset: ImageAsset): string {
  if (asset.isPrimary) return 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (asset.status === 'pending') return 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (asset.status === 'rejected') return 'border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300';
  return 'border-border bg-muted text-muted-foreground';
}

function VersionTile({
  asset,
  active,
  onPreview,
}: {
  asset: ImageAsset;
  active: boolean;
  onPreview: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPreview}
      className={cn(
        'relative h-[104px] w-[148px] shrink-0 overflow-hidden rounded-md border-2 text-left transition-colors',
        active ? 'border-foreground' : 'border-border hover:border-foreground/50',
      )}
    >
      <AssetImage asset={asset} />
      <span className={cn(
        'absolute left-1.5 top-1.5 rounded border px-1.5 py-0.5 text-[10px] font-medium',
        statusClasses(asset),
      )}>
        {asset.isPrimary ? '主图' : STATUS_LABEL[asset.status]}
      </span>
      {asset.availability === 'missing' ? (
        <span className="absolute bottom-1.5 right-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[9px] text-muted-foreground">
          仅记录
        </span>
      ) : null}
    </button>
  );
}

function ReassignSelect({
  asset,
  shots,
  onReassign,
}: {
  asset: ImageAsset;
  shots: WorkspaceShot[];
  onReassign: (shotNo: string) => void;
}) {
  return (
    <Select
      value={asset.canonicalShotNo ?? undefined}
      onValueChange={onReassign}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger size="sm" className="h-8 w-[104px] text-xs">
            <Link2 className="h-3.5 w-3.5" />
            <SelectValue placeholder="归属镜头" />
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>重新绑定镜头</TooltipContent>
      </Tooltip>
      <SelectContent>
        {shots.map(shot => (
          <SelectItem key={shot.shotNo} value={shot.shotNo}>
            {shot.shotNo}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function ShotImageWorkspace({
  shots,
  assets,
  focusShotNo,
  onFocusShot,
  onSelectImage,
  onReassignImage,
  onGenerateNext,
  generatingShotNo,
  generateError,
}: ShotImageWorkspaceProps) {
  const model = useMemo(
    () => buildImageAssetWorkspace(assets, shots.map(shot => shot.shotNo)),
    [assets, shots],
  );
  const resolvedFocus =
    focusShotNo && model.shotGroups.has(focusShotNo)
      ? focusShotNo
      : shots[0]?.shotNo ?? null;
  const group = resolvedFocus ? model.shotGroups.get(resolvedFocus) : undefined;
  const [previewId, setPreviewId] = useState<number | null>(null);

  useEffect(() => {
    setPreviewId(null);
  }, [resolvedFocus]);

  const previewAsset =
    group?.assets.find(asset => asset.id === previewId) ??
    group?.preview ??
    null;
  const focusShot = shots.find(shot => shot.shotNo === resolvedFocus);

  // ── 单图循环（U2）派生状态 ──
  const loopEnabled = Boolean(onGenerateNext && resolvedFocus);
  const isGenerating = Boolean(resolvedFocus && generatingShotNo === resolvedFocus);
  const errorForFocus =
    generateError && generateError.shotNo === resolvedFocus ? generateError : null;
  // 当前可处置的待确认图（最新一张 pending、非主图）——「收下/再来一张」作用于它
  const activePending =
    group?.assets.find(asset => asset.status === 'pending' && !asset.isPrimary) ?? null;
  const focusPrompt = resolveShotPrompt(focusShot, resolvedFocus ?? '');
  const startGenerate = (rejectImageId?: number) => {
    if (!loopEnabled || !resolvedFocus) return;
    void onGenerateNext?.({ shotNo: resolvedFocus, prompt: focusPrompt, rejectImageId });
  };

  return (
    <section className="shrink-0 border-b bg-background" aria-label="镜头图片工作区">
      {/* 连贯主视图（U3）：关键帧胶片条，按镜头顺序常驻，一眼看上下镜头判断连贯性；点格切焦点驱动循环 */}
      <div className="flex items-center gap-2 overflow-x-auto border-b px-3 py-2" aria-label="镜头连贯序列">
        <ImageIcon className="mr-1 h-4 w-4 shrink-0 text-muted-foreground" />
        {shots.map(shot => {
          const shotGroup = model.shotGroups.get(shot.shotNo);
          const keyframe = shotGroup?.primary ?? null;
          const hasPending = shotGroup?.assets.some(a => a.status === 'pending' && !a.isPrimary) ?? false;
          const active = resolvedFocus === shot.shotNo;
          return (
            <button
              key={shot.shotNo}
              type="button"
              onClick={() => onFocusShot(shot.shotNo)}
              title={shot.promptDraft || shot.sourceSummary || shot.shotNo}
              className={cn(
                'group relative h-12 w-[72px] shrink-0 overflow-hidden rounded-md border-2 bg-muted/40 transition-colors',
                active ? 'border-foreground' : 'border-border hover:border-foreground/50',
              )}
            >
              {keyframe ? (
                <AssetImage asset={keyframe} />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
                </div>
              )}
              {/* 镜号常驻底标 */}
              <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 text-center font-mono text-[9px] leading-4 text-white">
                {shot.shotNo}
              </span>
              {/* 状态角标：已收下关键帧 / 待确认 */}
              {keyframe ? (
                <span className="absolute right-0.5 top-0.5 rounded-full bg-emerald-500 p-0.5">
                  <Check className="h-2.5 w-2.5 text-white" />
                </span>
              ) : hasPending ? (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500" />
              ) : null}
            </button>
          );
        })}
        {model.unassigned.length > 0 ? (
          <span className="ml-auto shrink-0 self-start text-[10px] text-amber-700 dark:text-amber-300">
            {model.unassigned.length} 张待归属
          </span>
        ) : null}
      </div>

      <div className="grid min-h-[286px] grid-cols-1 lg:grid-cols-[minmax(340px,0.9fr)_minmax(460px,1.4fr)]">
        <div className="relative min-h-[260px] border-b bg-black/5 lg:border-b-0 lg:border-r">
          {isGenerating ? (
            // 生成中：图框内同尺寸骨架；被拒的上一张不保留可见
            <div className="flex h-full min-h-[260px] animate-pulse flex-col items-center justify-center gap-3 bg-muted text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-xs">正在画下一张…</p>
            </div>
          ) : errorForFocus && !group?.primary ? (
            // 循环中途失败、没有可保留的主图：inline 错误 + 重试，不回显被拒图
            <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-3 p-4 text-center">
              <AlertTriangle className="h-8 w-8 text-rose-500" />
              <p className="max-w-[260px] text-xs text-muted-foreground">{errorForFocus.message}</p>
              {loopEnabled ? (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => startGenerate()}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  重试
                </Button>
              ) : null}
            </div>
          ) : previewAsset ? (
            <>
              <AssetImage asset={previewAsset} className="absolute inset-0" />
              {/* 失败但有已收下主图可保留：顶部 inline 提示，旧图不清空 */}
              {errorForFocus ? (
                <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-rose-600/90 px-3 py-1.5 text-[11px] text-white">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{errorForFocus.message}</span>
                  {loopEnabled ? (
                    <button type="button" className="shrink-0 underline" onClick={() => startGenerate()}>
                      重试
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-12 text-white">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{resolvedFocus}</span>
                    <span className="rounded border border-white/30 bg-black/30 px-1.5 py-0.5 text-[10px]">
                      {previewAsset.isPrimary ? '主图' : STATUS_LABEL[previewAsset.status]}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-white/80">
                    {previewAsset.prompt || focusShot?.sourceSummary || '未记录画面提示'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* 单图循环：有待确认图 → 收下 / 再来一张；否则（已收下主图）→ 再来一张 */}
                  {activePending ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-8 gap-1"
                        onClick={() => void onSelectImage(activePending.id)}
                      >
                        <Check className="h-4 w-4" />
                        收下
                      </Button>
                      {loopEnabled ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-8 gap-1"
                          onClick={() => startGenerate(activePending.id)}
                        >
                          <RefreshCw className="h-4 w-4" />
                          再来一张
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {!previewAsset.isPrimary && previewAsset.availability !== 'missing' ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="secondary"
                              className="h-8 w-8"
                              onClick={() => void onSelectImage(previewAsset.id)}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>设为镜头主图</TooltipContent>
                        </Tooltip>
                      ) : null}
                      {/* 改这张（R6/F2）：在已收下的关键帧上整图微调，走小酌对话的 reviseImage 路径 */}
                      {previewAsset.isPrimary && previewAsset.availability !== 'missing' ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-8 gap-1"
                              onClick={() => window.dispatchEvent(new Event('dt:open-creation-chat'))}
                            >
                              <Wand2 className="h-4 w-4" />
                              改这张
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>对这张整图微调（如「改暖一点」）</TooltipContent>
                        </Tooltip>
                      ) : null}
                      {loopEnabled ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-8 gap-1"
                              onClick={() => startGenerate()}
                            >
                              <RefreshCw className="h-4 w-4" />
                              再来一张
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>另出一张</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </>
                  )}
                  <ReassignSelect
                    asset={previewAsset}
                    shots={shots}
                    onReassign={shotNo => void onReassignImage(previewAsset.id, shotNo)}
                  />
                </div>
              </div>
            </>
          ) : (
            // 空态：内嵌「画出来」，成为功能发现点
            <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-3 text-muted-foreground">
              <ImageIcon className="h-8 w-8" />
              <div className="text-center">
                <p className="text-sm font-medium">{resolvedFocus ?? '暂无镜头'}</p>
                <p className="mt-1 text-xs">还没有画面版本</p>
              </div>
              {loopEnabled ? (
                <Button size="sm" className="gap-1.5" onClick={() => startGenerate()}>
                  <Sparkles className="h-3.5 w-3.5" />
                  画出来
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => window.dispatchEvent(new Event('dt:open-creation-chat'))}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  让小酌生成
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="min-w-0 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-medium">
                <History className="h-3.5 w-3.5 text-muted-foreground" />
                版本
                <span className="text-[10px] font-normal text-muted-foreground">
                  {group?.assets.length ?? 0}
                </span>
              </div>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                {focusShot?.sceneNo ? `${focusShot.sceneNo} · ` : ''}
                {focusShot?.sourceSummary || focusShot?.mood || '镜头画面'}
              </p>
            </div>
          </div>

          <div className="mt-3 flex min-h-[104px] gap-2 overflow-x-auto pb-1">
            {group?.assets.length ? group.assets.map(asset => (
              <VersionTile
                key={asset.id}
                asset={asset}
                active={asset.id === previewAsset?.id}
                onPreview={() => setPreviewId(asset.id)}
              />
            )) : (
              <div className="flex h-[104px] w-full items-center justify-center border border-dashed text-xs text-muted-foreground">
                暂无版本
              </div>
            )}
          </div>

          {model.unassigned.length > 0 || model.styleReferences.length > 0 ? (
            <div className="mt-3 grid gap-3 border-t pt-3 xl:grid-cols-2">
              {model.unassigned.length > 0 ? (
                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    待归属
                  </div>
                  <div className="flex gap-2 overflow-x-auto">
                    {model.unassigned.map(asset => (
                      <div key={asset.id} className="flex w-[168px] shrink-0 items-center gap-2 rounded-md border p-1.5">
                        <div className="h-12 w-16 shrink-0 overflow-hidden rounded">
                          <AssetImage asset={asset} />
                        </div>
                        <ReassignSelect
                          asset={asset}
                          shots={shots}
                          onReassign={shotNo => void onReassignImage(asset.id, shotNo)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {model.styleReferences.length > 0 ? (
                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-cyan-700 dark:text-cyan-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    美术依据
                  </div>
                  <div className="flex gap-2 overflow-x-auto">
                    {model.styleReferences.map(asset => (
                      <div key={asset.id} className="h-14 w-20 shrink-0 overflow-hidden rounded-md border">
                        <AssetImage asset={asset} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
