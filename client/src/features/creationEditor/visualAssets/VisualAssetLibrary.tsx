import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Layers3,
  Loader2,
  Lock,
  Maximize2,
  Palette,
  PawPrint,
  Plus,
  UserRound,
  Warehouse,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import type {
  StoryVisualAsset,
  StoryVisualAssets,
  VisualAssetFixedFacts,
  VisualAssetKind,
  VisualAssetVersion,
  VisualAssetView,
} from "@shared/visualAssets";
import {
  isVisualAssetVersionLockable,
  recoverableVisualAssetBoardOperationToken,
  recoverableVisualAssetViewOperationToken,
  visualAssetFixedFactsAreComplete,
} from "@shared/visualAssets";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import VisualAssetCreationDialog, {
  type VisualAssetCreationValue,
  type VisualAssetImageOption,
  visualAssetKindLabel,
} from "./VisualAssetCreationDialog";
import ShotAssetBindingPanel from "./ShotAssetBindingPanel";

const KIND_ICON = {
  character: UserRound,
  pet: PawPrint,
  scene: Warehouse,
  style: Palette,
} satisfies Record<VisualAssetKind, typeof UserRound>;

const STATUS_LABEL: Record<VisualAssetVersion["status"], string> = {
  draft: "草案",
  generating_views: "正在生成标准视图",
  review: "待检查",
  locked: "已锁定",
  superseded: "历史版本",
};

const VIEW_ROLE_LABEL: Record<VisualAssetView["role"], string> = {
  front: "正面全身",
  profile: "严格 90° 侧面全身",
  back: "背面全身",
  "identity-detail": "正面头部特写",
  establishing: "建立视角",
  reverse: "反向视角",
  side: "侧向视角",
  top: "正交俯视",
  "character-sample": "人物风格样例",
  "scene-sample": "场景风格样例",
  "object-sample": "物件风格样例",
  "closeup-sample": "细节风格样例",
};

export function visualAssetBoardConfirmationMessage(
  kind: VisualAssetKind,
  quote: { candidateCount: number; estimatedCny: number }
): string {
  return kind === "character" || kind === "pet"
    ? `分 ${quote.candidateCount} 次生成正面头部特写、正面全身、严格 90° 侧面全身和背面全身，再由服务端合成${kind === "pet" ? "宠物" : "人物"}标准板，预计最高 ¥${quote.estimatedCny.toFixed(2)}。是否继续？`
    : `分 ${quote.candidateCount} 次生成 ${quote.candidateCount} 个标准视角，再由服务端合成标准板，预计最高 ¥${quote.estimatedCny.toFixed(2)}。是否继续？`;
}

function operationToken(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

function factsSummary(facts: VisualAssetFixedFacts): string[] {
  if (facts.kind === "character") {
    return [facts.face, facts.hair, facts.outfit, ...facts.accessories].filter(Boolean);
  }
  if (facts.kind === "pet") {
    return [
      facts.species,
      facts.face,
      facts.coat,
      facts.body,
      ...facts.distinctiveFeatures,
      ...facts.accessories,
    ].filter(Boolean);
  }
  if (facts.kind === "scene") {
    return [...facts.geometry, ...facts.materials, ...facts.fixedProps];
  }
  return [
    ...facts.medium,
    ...facts.brushwork,
    ...facts.formLanguage,
    ...facts.colorLanguage,
  ];
}

function recommendedConflictResolution(
  version: VisualAssetVersion,
  field: string
): string | undefined {
  const current = (version.fixedFacts as unknown as Record<string, unknown>)[field];
  if (typeof current === "string" && current.trim()) return current.trim();
  return undefined;
}

export function visualAssetLockBlockers(
  asset: Pick<StoryVisualAsset, "kind">,
  version: VisualAssetVersion
): string[] {
  const blockers: string[] = [];
  if (factsSummary(version.fixedFacts).length === 0) blockers.push("固定事实尚未完成");
  if (version.conflicts.some(conflict => !conflict.resolution)) {
    blockers.push("参考图冲突尚未处理");
  }
  if (!version.boardImageId || version.views.length === 0) {
    blockers.push("标准视图尚未生成");
  } else if (version.views.some(view => view.status !== "pass")) {
    blockers.push("标准视图尚未全部通过");
  }
  if (!isVisualAssetVersionLockable(asset.kind, version) && blockers.length === 0) {
    blockers.push("资产固定事实或标准视图不完整");
  }
  return blockers;
}

function selectedVersionOf(asset: StoryVisualAsset, versionId?: string) {
  return (
    asset.versions.find(version => version.id === versionId) ??
    asset.versions.find(version => version.id === asset.currentVersionId) ??
    asset.versions[asset.versions.length - 1]
  );
}

export default function VisualAssetLibrary({
  storyId,
  images,
  compact = false,
  currentStableShotId,
  onRequestImport,
}: {
  storyId: number | null;
  images: VisualAssetImageOption[];
  compact?: boolean;
  currentStableShotId?: string | null;
  onRequestImport?: () => void;
}) {
  const utils = trpc.useUtils();
  const query = trpc.visualAssets.read.useQuery(
    { storyId: storyId ?? 1 },
    { enabled: storyId != null && storyId > 0, retry: false, refetchOnWindowFocus: false }
  );
  const createDraft = trpc.visualAssets.createDraft.useMutation();
  const createVersion = trpc.visualAssets.createVersion.useMutation();
  const lockVersion = trpc.visualAssets.lockVersion.useMutation();
  const forkVersion = trpc.visualAssets.forkVersion.useMutation();
  const deleteVersion = trpc.visualAssets.deleteVersion.useMutation();
  const deleteAsset = trpc.visualAssets.deleteAsset.useMutation();
  const analyzeVersion = trpc.visualAssets.analyzeVersion.useMutation();
  const resolveConflictsMutation = trpc.visualAssets.resolveConflicts.useMutation();
  const quoteBoard = trpc.visualAssets.quoteCanonicalBoard.useMutation();
  const generateBoardMutation = trpc.visualAssets.generateCanonicalBoard.useMutation();
  const quoteView = trpc.visualAssets.quoteView.useMutation();
  const regenerateViewMutation = trpc.visualAssets.regenerateView.useMutation();
  const [dialog, setDialog] = useState<{
    assetId?: string;
    kind?: VisualAssetKind;
    name?: string;
  } | null>(null);
  const [selectedVersionIds, setSelectedVersionIds] = useState<Record<string, string>>({});
  const [lockingVersionId, setLockingVersionId] = useState<string | null>(null);
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);
  const [processingVersionId, setProcessingVersionId] = useState<string | null>(null);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, string>>({});
  const [expandedCompactAssetId, setExpandedCompactAssetId] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<{
    src: string;
    title: string;
    description: string;
  } | null>(null);
  const [viewOperationTokens, setViewOperationTokens] = useState<
    Record<string, string>
  >({});

  const aggregate = (query.data?.aggregate as StoryVisualAssets | undefined) ?? null;
  const assets = aggregate?.assets ?? [];
  const imageById = useMemo(
    () => new Map(images.map(image => [image.id, image])),
    [images]
  );
  const pending = createDraft.isPending || createVersion.isPending;

  const refresh = async () => {
    if (storyId == null) return;
    await Promise.all([
      utils.visualAssets.read.invalidate({ storyId }),
      utils.storyAgent.storyMaterialState.invalidate({ storyId }),
      query.refetch(),
    ]);
  };

  const submit = async (value: VisualAssetCreationValue) => {
    if (storyId == null || !query.data) return;
    try {
      if (dialog?.assetId) {
        await createVersion.mutateAsync({
          storyId,
          expectedRevision: query.data.revision,
          operationToken: operationToken("visual-version"),
          assetId: dialog.assetId,
          references: value.references,
        });
        toast.success("新版本草案已创建，旧版本和历史镜头保持不变");
      } else {
        await createDraft.mutateAsync({
          storyId,
          expectedRevision: query.data.revision,
          operationToken: operationToken("visual-create"),
          kind: value.kind,
          name: value.name,
          references: value.references,
        });
        toast.success("资产草案已创建，下一步生成并检查标准视图");
      }
      setDialog(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "资产草案创建失败");
    }
  };

  /** 以已锁版本为基础改：派生新版本，继承验收通过的视图，只补买要换的那几栏。 */
  const forkForEdit = async (asset: StoryVisualAsset, version: VisualAssetVersion) => {
    if (storyId == null || !query.data) return;
    setBusyVersionId(version.id);
    try {
      await forkVersion.mutateAsync({
        storyId,
        expectedRevision: query.data.revision,
        operationToken: operationToken("visual-fork"),
        assetId: asset.id,
        sourceVersionId: version.id,
      });
      toast.success(
        `已基于版本 ${version.version} 建立可编辑副本，通过验收的标准视图已继承，不用重新付费`
      );
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "建立可编辑副本失败");
    } finally {
      setBusyVersionId(null);
    }
  };

  const removeVersion = async (asset: StoryVisualAsset, version: VisualAssetVersion) => {
    if (storyId == null || !query.data) return;
    // 删版本不会删已生成的图片，这一点要在确认框里说清楚，否则用户会以为花的钱没了。
    if (
      !window.confirm(
        `删除 ${asset.name} 的版本 ${version.version}？\n已生成的标准视图图片会保留在素材仓库里，不会被删除。`
      )
    ) {
      return;
    }
    setBusyVersionId(version.id);
    try {
      await deleteVersion.mutateAsync({
        storyId,
        expectedRevision: query.data.revision,
        operationToken: operationToken("visual-del-version"),
        assetId: asset.id,
        versionId: version.id,
      });
      toast.success(`版本 ${version.version} 已删除，图片仍保留在素材仓库`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除版本失败");
    } finally {
      setBusyVersionId(null);
    }
  };

  const removeAsset = async (asset: StoryVisualAsset) => {
    if (storyId == null || !query.data) return;
    if (
      !window.confirm(
        `删除资产「${asset.name}」及其全部版本？\n已生成的图片会保留在素材仓库里，不会被删除。`
      )
    ) {
      return;
    }
    setBusyVersionId(asset.id);
    try {
      await deleteAsset.mutateAsync({
        storyId,
        expectedRevision: query.data.revision,
        operationToken: operationToken("visual-del-asset"),
        assetId: asset.id,
      });
      toast.success(`资产「${asset.name}」已删除，图片仍保留在素材仓库`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除资产失败");
    } finally {
      setBusyVersionId(null);
    }
  };

  const lock = async (asset: StoryVisualAsset, version: VisualAssetVersion) => {
    if (storyId == null || !query.data) return;
    setLockingVersionId(version.id);
    try {
      await lockVersion.mutateAsync({
        storyId,
        expectedRevision: query.data.revision,
        operationToken: operationToken("visual-lock"),
        assetId: asset.id,
        versionId: version.id,
      });
      toast.success(`${asset.name} · 版本 ${version.version} 已锁定`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "资产锁定失败");
    } finally {
      setLockingVersionId(null);
    }
  };

  const analyze = async (asset: StoryVisualAsset, version: VisualAssetVersion) => {
    if (storyId == null || !query.data) return;
    setProcessingVersionId(version.id);
    try {
      await analyzeVersion.mutateAsync({
        storyId,
        expectedRevision: query.data.revision,
        operationToken: operationToken("visual-analyze"),
        assetId: asset.id,
        versionId: version.id,
      });
      toast.success("参考图分析完成，请检查固定事实和冲突");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "参考图分析失败");
    } finally {
      setProcessingVersionId(null);
    }
  };

  const generateBoard = async (asset: StoryVisualAsset, version: VisualAssetVersion) => {
    if (storyId == null) return;
    setProcessingVersionId(version.id);
    try {
      const quote = await quoteBoard.mutateAsync({
        storyId,
        assetId: asset.id,
        versionId: version.id,
      });
      // 报价是所有视角的总额：每个视角都是一次独立付费生成，标准板由服务端合成。
      const confirmed = window.confirm(
        visualAssetBoardConfirmationMessage(asset.kind, quote)
      );
      if (!confirmed) return;
      const recoveredOperationToken = recoverableVisualAssetBoardOperationToken(
        aggregate?.operations ?? [],
        quote.inputHash
      );
      if (recoveredOperationToken) {
        toast.info("正在恢复原标准视图任务，已成功的付费视角会直接复用");
      }
      const result = await generateBoardMutation.mutateAsync({
        storyId,
        assetId: asset.id,
        versionId: version.id,
        operationToken:
          recoveredOperationToken ?? operationToken("visual-board"),
        confirmation: quote,
      });
      if (result.status === "ok") {
        // 生成成功 ≠ 版式合格。结构质检不通过时必须直说，不能报喜。
        if (result.structure.verdict === "pass") {
          toast.success(
            asset.kind === "character" || asset.kind === "pet"
              ? `${visualAssetKindLabel(asset.kind)}标准视图已生成，请检查头部特写、正面、侧面和背面后再锁定`
              : "标准视图已生成，请逐格检查后再锁定"
          );
        } else if (result.structure.verdict === "fail") {
          toast.error(`标准板不合格：${result.structure.reason}`);
        } else {
          toast.warning(`标准板结构未确认：${result.structure.reason}`);
        }
        await refresh();
      } else if (result.status === "confirmation_required") {
        toast.error("报价已变化，请重新确认");
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "标准视图生成失败");
    } finally {
      setProcessingVersionId(null);
    }
  };

  const regenerateView = async (
    asset: StoryVisualAsset,
    version: VisualAssetVersion,
    view: VisualAssetVersion["views"][number]
  ) => {
    if (storyId == null) return;
    const operationKey = `${version.id}:${view.role}`;
    setProcessingVersionId(version.id);
    try {
      const quote = await quoteView.mutateAsync({
        storyId,
        assetId: asset.id,
        versionId: version.id,
        role: view.role,
      });
      const viewToken =
        viewOperationTokens[operationKey] ??
        recoverableVisualAssetViewOperationToken(
          aggregate?.operations ?? [],
          quote.inputHash,
          view.role
        ) ??
        operationToken(`visual-view-${view.role}`);
      setViewOperationTokens(current => ({
        ...current,
        [operationKey]: viewToken,
      }));
      const confirmed = window.confirm(
        `只重新生成「${VIEW_ROLE_LABEL[view.role]}」这一张，其余已付费视角直接复用。预计最高 ¥${quote.estimatedCny.toFixed(2)}。是否继续？`
      );
      if (!confirmed) return;
      const result = await regenerateViewMutation.mutateAsync({
        storyId,
        assetId: asset.id,
        versionId: version.id,
        role: view.role,
        operationToken: viewToken,
        confirmation: quote,
      });
      if (result.status === "ok") {
        setViewOperationTokens(current => {
          const next = { ...current };
          delete next[operationKey];
          return next;
        });
        if (result.structure.verdict === "pass") {
          toast.success(`${VIEW_ROLE_LABEL[view.role]}已重新生成并通过结构质检`);
        } else if (result.structure.verdict === "fail") {
          toast.error(`新标准板不合格：${result.structure.reason}`);
        } else {
          toast.warning(`新标准板结构未确认：${result.structure.reason}`);
        }
        await refresh();
      } else if (result.status === "confirmation_required") {
        toast.error("报价已变化，请重新确认");
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "单视角重新生成失败");
    } finally {
      setProcessingVersionId(null);
    }
  };

  const resolveConflicts = async (
    asset: StoryVisualAsset,
    version: VisualAssetVersion
  ) => {
    if (storyId == null || !query.data) return;
    const unresolved = version.conflicts.filter(conflict => !conflict.resolution);
    const resolutions = unresolved.flatMap(conflict => {
      const resolution =
        conflictResolutions[`${version.id}:${conflict.field}`] ??
        recommendedConflictResolution(version, conflict.field);
      return resolution ? [{ field: conflict.field, resolution }] : [];
    });
    if (resolutions.length !== unresolved.length) {
      toast.error("请为每一项冲突选择权威描述");
      return;
    }
    setProcessingVersionId(version.id);
    try {
      await resolveConflictsMutation.mutateAsync({
        storyId,
        expectedRevision: query.data.revision,
        operationToken: operationToken("visual-resolve"),
        assetId: asset.id,
        versionId: version.id,
        resolutions,
      });
      toast.success("冲突裁决已保存，现在可以生成人物标准视图");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "冲突裁决保存失败");
    } finally {
      setProcessingVersionId(null);
    }
  };

  if (storyId == null) {
    return <div className="p-6 text-center text-sm text-muted-foreground">请先打开一个 Story</div>;
  }

  const createAssetButton = (
    <button
      type="button"
      onClick={() => setDialog({})}
      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground"
    >
      <Plus className="h-3.5 w-3.5" />
      创建资产
    </button>
  );

  return (
    <section className="min-w-0" aria-label="视觉资产库">
      {!compact ? (
        <div className="mb-2 flex justify-end" aria-label="资产操作">
          {createAssetButton}
        </div>
      ) : null}

      {query.isLoading ? (
        <div className="flex min-h-32 items-center justify-center rounded-md border border-border text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在读取资产
        </div>
      ) : query.error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {query.error.message}
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-5 py-8 text-center">
          <Layers3 className="mx-auto h-6 w-6 text-muted-foreground" />
          <div className="mt-2 text-sm font-medium">还没有视觉资产</div>
          <div className="mt-1 text-xs text-muted-foreground">
            选择类型和参考图，先建立一份可检查的资产草案。
          </div>
        </div>
      ) : (
        <div
          className={`grid min-w-0 grid-cols-1 ${compact ? "gap-2" : "gap-3"}`}
          data-visual-asset-layout={compact ? "drawer-stack" : "single-column"}
        >
          {assets.map(asset => {
            const Icon = KIND_ICON[asset.kind];
            const version = selectedVersionOf(asset, selectedVersionIds[asset.id]);
            if (!version) return null;
            const blockers = visualAssetLockBlockers(asset, version);
            const canLock =
              version.status !== "locked" &&
              version.status !== "superseded" &&
              blockers.length === 0;
            const needsAnalysis = !visualAssetFixedFactsAreComplete(version.fixedFacts);
            const canGenerateBoard =
              !needsAnalysis &&
              version.views.length === 0 &&
              !version.conflicts.some(conflict => !conflict.resolution);
            const unresolvedConflicts = version.conflicts.filter(
              conflict => !conflict.resolution
            );
            const processing = processingVersionId === version.id;
            const boardImage = version.boardImageId
              ? imageById.get(version.boardImageId)
              : undefined;
            const rejectedView = version.views.find(
              view => view.status !== "pass" && view.failureReason
            );
            const compactExpanded = compact && expandedCompactAssetId === asset.id;
            const assetIdentity = (
              <>
                <span className={`flex shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ${compact ? "h-7 w-7" : "h-8 w-8"}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{asset.name}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {visualAssetKindLabel(asset.kind)} · {STATUS_LABEL[version.status]}
                  </span>
                </span>
              </>
            );
            return (
              <article
                key={asset.id}
                className="min-w-0 overflow-hidden rounded-lg border border-border bg-background"
              >
                <div className={`flex flex-wrap items-start justify-between gap-2 ${compact ? "px-2 py-1.5" : "border-b border-border p-3"}`}>
                  {compact ? (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedCompactAssetId(current =>
                          current === asset.id ? null : asset.id
                        )
                      }
                      aria-expanded={compactExpanded}
                      aria-controls={`visual-asset-details-${asset.id}`}
                      className="flex min-w-0 flex-1 items-start gap-2.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    >
                      {assetIdentity}
                      {compactExpanded ? (
                        <ChevronDown className="mt-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="mt-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  ) : (
                    <div className="flex min-w-0 flex-1 items-start gap-2.5">
                      {assetIdentity}
                    </div>
                  )}
                  <select
                    value={version.id}
                    onChange={event =>
                      setSelectedVersionIds(current => ({
                        ...current,
                        [asset.id]: event.currentTarget.value,
                      }))
                    }
                    className="h-7 max-w-full rounded border border-border bg-background px-1.5 text-[11px]"
                    aria-label={`${asset.name} 版本`}
                  >
                    {[...asset.versions]
                      .sort((left, right) => right.version - left.version)
                      .map(item => (
                        <option key={item.id} value={item.id}>
                          版本 {item.version} · {STATUS_LABEL[item.status]}
                        </option>
                      ))}
                  </select>
                </div>

                {!compact || compactExpanded ? (
                <div
                  id={`visual-asset-details-${asset.id}`}
                  className="space-y-3 border-t border-border p-3"
                >
                  {boardImage ? (
                    <figure className="overflow-hidden rounded-md border border-border bg-muted/30">
                      <button
                        type="button"
                        onClick={() =>
                          setImagePreview({
                            src: boardImage.imageUrl,
                            title: `${asset.name} · 标准板`,
                            description:
                              asset.kind === "character" || asset.kind === "pet"
                                ? "头部特写 / 正面全身 / 侧面全身 / 背面全身"
                                : "完整标准视图板",
                          })
                        }
                        aria-label={`查看 ${asset.name} 标准板大图`}
                        className="group relative block w-full cursor-zoom-in bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                      >
                        <img
                          src={boardImage.imageUrl}
                          alt={
                            asset.kind === "character" || asset.kind === "pet"
                              ? `${asset.name} ${visualAssetKindLabel(asset.kind)}标准视图板`
                              : `${asset.name} 标准板`
                          }
                          className={compact ? "max-h-52 w-full object-contain" : "aspect-square w-full object-contain"}
                        />
                        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded bg-black/65 px-2 py-1 text-[10px] font-medium text-white opacity-90 transition group-hover:opacity-100">
                          <Maximize2 className="h-3 w-3" />
                          查看大图
                        </span>
                      </button>
                      <figcaption className="border-t border-border px-2 py-1.5 text-[10px] font-medium text-muted-foreground">
                        {asset.kind === "character" || asset.kind === "pet"
                          ? `${visualAssetKindLabel(asset.kind)}标准视图 · 头部特写 / 正面 / 侧面 / 背面`
                          : "完整标准板"}
                      </figcaption>
                    </figure>
                  ) : null}
                  {rejectedView ? (
                    <div
                      className={`flex items-start gap-1.5 rounded border px-2 py-1.5 text-[11px] ${
                        rejectedView.status === "fail"
                          ? "border-destructive/40 bg-destructive/10 text-destructive"
                          : "border-amber-300 bg-amber-50 text-amber-800"
                      }`}
                    >
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>
                        {rejectedView.status === "fail" ? "标准板不合格：" : "标准板结构未确认："}
                        {rejectedView.failureReason}
                      </span>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-4 gap-2">
                    {version.views.length > 0 ? (
                      version.views.map(view => {
                        const image = imageById.get(view.imageId);
                        return (
                          <div key={view.id} className="overflow-hidden rounded border border-border bg-muted">
                            {image ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setImagePreview({
                                    src: image.imageUrl,
                                    title: `${asset.name} · ${view.role}`,
                                    description: `标准视图 #${view.imageId}`,
                                  })
                                }
                                aria-label={`查看 ${asset.name} ${view.role} 大图`}
                                className="group relative block w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                              >
                                <img src={image.imageUrl} alt={view.role} className="aspect-square w-full object-cover" />
                                <Maximize2 className="absolute right-1.5 top-1.5 h-3 w-3 text-white drop-shadow" />
                              </button>
                            ) : (
                              <div className="flex aspect-square items-center justify-center px-1 text-center text-[9px] text-muted-foreground">
                                标准视图 #{view.imageId}
                              </div>
                            )}
                            <div className="flex items-center justify-between gap-1 px-1.5 py-1 text-[9px] text-muted-foreground">
                              <span className="truncate">{VIEW_ROLE_LABEL[view.role]}</span>
                              {view.status === "pass" ? (
                                <Check className="h-2.5 w-2.5 text-emerald-600" />
                              ) : view.status === "fail" ? (
                                <X className="h-2.5 w-2.5 text-destructive" />
                              ) : (
                                <AlertTriangle className="h-2.5 w-2.5 text-amber-600" />
                              )}
                            </div>
                            {view.status !== "pass" ? (
                              <button
                                type="button"
                                onClick={() => void regenerateView(asset, version, view)}
                                disabled={processing}
                                className="flex min-h-7 w-full items-center justify-center border-t border-border bg-background px-1.5 py-1 text-[9px] font-medium text-primary transition hover:bg-primary/5 disabled:opacity-50"
                                aria-label={`重新生成 ${asset.name} ${VIEW_ROLE_LABEL[view.role]}`}
                              >
                                重生此视角
                              </button>
                            ) : null}
                          </div>
                        );
                      })
                    ) : (
                      <div className="col-span-4 rounded border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                        {asset.kind === "character" || asset.kind === "pet"
                          ? `尚未生成${visualAssetKindLabel(asset.kind)}标准视图`
                          : "尚未生成标准视图"}
                      </div>
                    )}
                  </div>

                  {factsSummary(version.fixedFacts).length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {factsSummary(version.fixedFacts).slice(0, 8).map(fact => (
                        <span key={fact} className="max-w-full whitespace-normal break-words rounded bg-muted px-2 py-1 text-[10px] leading-relaxed text-muted-foreground">
                          {fact}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {unresolvedConflicts.length > 0 ? (
                    <div className="rounded-md border border-amber-300/60 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
                      <div className="flex items-center gap-1 font-semibold">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {asset.kind === "character" || asset.kind === "pet"
                          ? `下一步：确认${visualAssetKindLabel(asset.kind)}固定${asset.kind === "pet" ? "外观" : "造型"}`
                          : "下一步：确认资产固定事实"}
                      </div>
                      <p className="mt-1 text-[10px] leading-relaxed text-amber-700">
                        {asset.kind === "character" || asset.kind === "pet"
                          ? `AI 在参考图中发现差异。已整理的${visualAssetKindLabel(asset.kind)}固定${asset.kind === "pet" ? "外观" : "造型"}会作为推荐值；你也可以在下拉框改成其他版本。`
                          : "AI 在参考图中发现差异。请选择这个资产以后必须保持的版本。"}
                      </p>
                      {unresolvedConflicts.map(conflict => {
                        const recommended = recommendedConflictResolution(
                          version,
                          conflict.field
                        );
                        const selected =
                          conflictResolutions[`${version.id}:${conflict.field}`] ??
                          recommended ??
                          "";
                        return (
                          <div key={conflict.field} className="mt-1">
                            <label className="block font-medium">
                              {conflict.field} · 选择以后必须保持的版本
                              <select
                                value={selected}
                                onChange={event =>
                                  setConflictResolutions(current => ({
                                    ...current,
                                    [`${version.id}:${conflict.field}`]: event.currentTarget.value,
                                  }))
                                }
                                className="mt-1 h-8 w-full rounded border border-amber-300 bg-white px-1.5 text-[10px] text-amber-950"
                              >
                                <option value="">请选择权威描述</option>
                                {recommended ? (
                                  <option value={recommended}>
                                    推荐：使用已整理的固定造型 · {recommended}
                                  </option>
                                ) : null}
                                {conflict.descriptions.map((description, index) => (
                                  description === recommended ? null : (
                                    <option key={`${conflict.field}-${index}`} value={description}>
                                      {description}
                                    </option>
                                  )
                                ))}
                              </select>
                            </label>
                          </div>
                        );
                      })}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void resolveConflicts(asset, version)}
                          disabled={processing}
                          className="inline-flex h-8 flex-1 items-center justify-center rounded-md bg-amber-700 px-3 text-[11px] font-semibold text-white disabled:opacity-50"
                        >
                          {asset.kind === "character" || asset.kind === "pet"
                            ? `确认推荐${asset.kind === "pet" ? "外观" : "造型"}，继续生成标准视图`
                            : "确认推荐事实，继续生成标准板"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void analyze(asset, version)}
                          disabled={processing}
                          className="inline-flex h-8 items-center justify-center rounded-md border border-amber-300 bg-white px-3 text-[11px] font-medium text-amber-800 disabled:opacity-50"
                        >
                          重新分析
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {blockers.length > 0 && version.status !== "locked" && version.status !== "superseded" ? (
                    <div className="text-[11px] text-muted-foreground">锁定前还需：{blockers.join("、")}</div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    {needsAnalysis ? (
                      <button
                        type="button"
                        onClick={() => void analyze(asset, version)}
                        disabled={processing}
                        className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 text-xs font-medium text-primary disabled:opacity-50"
                      >
                        {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        分析参考图
                      </button>
                    ) : canGenerateBoard ? (
                      <button
                        type="button"
                        onClick={() => void generateBoard(asset, version)}
                        disabled={processing}
                        className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 text-xs font-medium text-primary disabled:opacity-50"
                      >
                        {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        {asset.kind === "character" || asset.kind === "pet"
                          ? `生成${visualAssetKindLabel(asset.kind)}标准视图`
                          : "生成标准视图"}
                      </button>
                    ) : unresolvedConflicts.length > 0 ? (
                      <button
                        type="button"
                        disabled
                        className="inline-flex min-h-8 min-w-48 flex-1 cursor-not-allowed items-center justify-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-center text-xs font-medium text-primary/70"
                      >
                        确认
                        {asset.kind === "character" ? "造型" : "固定事实"}
                        后，此处直接生成
                        {visualAssetKindLabel(asset.kind)}标准视图
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setDialog({ assetId: asset.id, kind: asset.kind, name: asset.name })}
                      className="h-8 flex-1 rounded-md border border-border px-2 text-xs hover:border-primary/50 hover:text-primary"
                    >
                      建立新版本
                    </button>
                    {version.status === "locked" || version.status === "superseded" ? (
                      // 锁定版本不可变，改只能派生副本；已验收的视图会继承，不重复付费。
                      <button
                        type="button"
                        onClick={() => void forkForEdit(asset, version)}
                        disabled={busyVersionId === version.id}
                        className="h-8 flex-1 rounded-md border border-border px-2 text-xs hover:border-primary/50 hover:text-primary disabled:opacity-40"
                      >
                        在此基础上修改
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void lock(asset, version)}
                      disabled={!canLock || lockingVersionId === version.id}
                      className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {lockingVersionId === version.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Lock className="h-3.5 w-3.5" />
                      )}
                      {version.status === "locked" ? "已锁定" : "锁定此版本"}
                    </button>
                  </div>
                  <div className="flex items-center justify-end gap-3 px-3 pb-2.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => void removeVersion(asset, version)}
                      disabled={busyVersionId === version.id}
                      className="text-muted-foreground underline-offset-2 hover:text-destructive hover:underline disabled:opacity-40"
                    >
                      删除此版本
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeAsset(asset)}
                      disabled={busyVersionId === asset.id}
                      className="text-muted-foreground underline-offset-2 hover:text-destructive hover:underline disabled:opacity-40"
                    >
                      删除整个资产
                    </button>
                  </div>
                </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {compact ? (
        <div className="mt-2 flex justify-end" aria-label="资产操作">
          {createAssetButton}
        </div>
      ) : null}

      {aggregate && query.data ? (
        <ShotAssetBindingPanel
          storyId={storyId}
          revision={query.data.revision}
          aggregate={aggregate}
          currentStableShotId={currentStableShotId}
          onChanged={refresh}
        />
      ) : null}

      <VisualAssetCreationDialog
        open={dialog != null}
        images={images}
        initialKind={dialog?.kind}
        initialName={dialog?.name}
        submitLabel={dialog?.assetId ? "创建新版本草案" : "创建资产草案"}
        pending={pending}
        onClose={() => setDialog(null)}
        onRequestImport={
          onRequestImport
            ? () => {
                setDialog(null);
                onRequestImport();
              }
            : undefined
        }
        onSubmit={submit}
      />

      <Dialog
        open={imagePreview != null}
        onOpenChange={open => {
          if (!open) setImagePreview(null);
        }}
      >
        <DialogContent className="max-h-[calc(100vh-1rem)] max-w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden p-4 sm:max-w-[calc(100vw-2rem)]">
          <DialogHeader className="min-w-0 pr-8">
            <DialogTitle className="truncate text-base">
              {imagePreview?.title ?? "资产大图"}
            </DialogTitle>
            <DialogDescription>
              {imagePreview?.description ?? "按原始比例查看资产图片"}
            </DialogDescription>
          </DialogHeader>
          {imagePreview ? (
            <div className="flex min-h-0 items-center justify-center overflow-auto rounded-lg bg-black/90 p-3">
              <img
                src={imagePreview.src}
                alt={imagePreview.title}
                className="max-h-[calc(100vh-8rem)] max-w-full object-contain"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
