import { AlertTriangle, Check, Link2, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type {
  ShotVisualAssetBindingProposal,
  ShotVisualAssetSelection,
  StoryVisualAssets,
  VisualAssetKind,
} from "@shared/visualAssets";
import { VISUAL_ASSET_KINDS } from "@shared/visualAssets";
import { trpc } from "@/lib/trpc";
import { visualAssetKindLabel } from "./VisualAssetCreationDialog";

function token(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function selectionKey(selection: ShotVisualAssetSelection): string {
  return VISUAL_ASSET_KINDS
    .map(kind => `${kind}:${selection[kind]?.assetId ?? ""}:${selection[kind]?.versionId ?? ""}`)
    .join("|");
}

export function proposalCanBeConfirmed(
  proposal: Pick<ShotVisualAssetBindingProposal, "conflicts" | "selections">,
  current: ShotVisualAssetSelection
): boolean {
  return (
    VISUAL_ASSET_KINDS.some(kind => Boolean(current[kind])) &&
    (proposal.conflicts.length === 0 ||
      selectionKey(current) !== selectionKey(proposal.selections))
  );
}

export type BindingShotContext = {
  imageUrl?: string | null;
  dialogue?: string | null;
  action?: string | null;
  imagePrompt?: string | null;
};

export default function ShotAssetBindingPanel({
  storyId,
  revision,
  aggregate,
  currentStableShotId,
  currentShotLabel,
  currentShotContext,
  compact = false,
  onChanged,
}: {
  storyId: number;
  revision: number;
  aggregate: StoryVisualAssets;
  currentStableShotId?: string | null;
  currentShotLabel?: string;
  currentShotContext?: BindingShotContext;
  compact?: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const saveDefault = trpc.visualAssets.setDefaultPet.useMutation();
  const [defaultPetKey, setDefaultPetKey] = useState(aggregate.defaultPet ? `${aggregate.defaultPet.assetId}::${aggregate.defaultPet.versionId}` : "");
  useEffect(() => {
    setDefaultPetKey(aggregate.defaultPet ? `${aggregate.defaultPet.assetId}::${aggregate.defaultPet.versionId}` : "");
  }, [aggregate.defaultPet?.assetId, aggregate.defaultPet?.versionId]);
  const applyDefault = async () => {
    setDefaultError(null);
    const [assetId, versionId] = defaultPetKey.split("::");
    try {
      await saveDefault.mutateAsync({ storyId, expectedRevision: revision, operationToken: token("story-default-pet"), pet: defaultPetKey ? { assetId, versionId } : null });
      await onChanged();
      toast.success(defaultPetKey ? "已设为整场戏默认宠物，有它出场时使用同一身份" : "已取消整场戏默认宠物");
    } catch (error) {
      setDefaultError(error instanceof Error ? error.message : "保存默认宠物失败");
      await onChanged();
    }
  };
  const propose = trpc.visualAssets.proposeBindings.useMutation();
  const confirm = trpc.visualAssets.confirmBindings.useMutation();
  const [selectedProposalIds, setSelectedProposalIds] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, ShotVisualAssetSelection>>({});
  const [currentShotSelection, setCurrentShotSelection] =
    useState<ShotVisualAssetSelection>({});

  const defaultPetOptions = aggregate.assets.filter(asset => asset.kind === "pet").flatMap(asset => asset.versions.filter(version => version.status !== "superseded" && version.views.some(view => view.role === "identity-detail")).map(version => ({ asset, version })));
  const proposals = aggregate.proposals.filter(proposal => proposal.status === "pending");
  useEffect(() => {
    setOverrides(
      Object.fromEntries(proposals.map(proposal => [proposal.id, proposal.selections]))
    );
    setSelectedProposalIds(
      proposals.filter(proposal => proposal.conflicts.length === 0).map(proposal => proposal.id)
    );
  }, [aggregate.proposals]);

  const lockedOptions = useMemo(
    () =>
      aggregate.assets.flatMap(asset => {
        const version = asset.versions.find(
          item => item.id === asset.currentVersionId && item.status === "locked"
        );
        return version ? [{ asset, version }] : [];
      }),
    [aggregate.assets]
  );

  useEffect(() => {
    const binding = aggregate.bindings.find(
      item => item.stableShotId === currentStableShotId
    );
    setCurrentShotSelection(
      binding
        ? {
            ...(binding.character ? { character: binding.character } : {}),
            ...(binding.pet ? { pet: binding.pet } : {}),
            ...(binding.scene ? { scene: binding.scene } : {}),
            ...(binding.style ? { style: binding.style } : {}),
          }
        : {}
    );
  }, [aggregate.bindings, currentStableShotId]);

  const ask = async () => {
    try {
      const result = await propose.mutateAsync({
        storyId,
        expectedRevision: revision,
        operationToken: token("visual-propose"),
      });
      toast.success(`已生成 ${result.proposals.length} 条镜头绑定建议`);
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "绑定建议生成失败");
    }
  };

  const updateKind = (
    proposal: ShotVisualAssetBindingProposal,
    kind: VisualAssetKind,
    value: string
  ) => {
    setOverrides(current => {
      const next = { ...(current[proposal.id] ?? proposal.selections) };
      if (!value) delete next[kind];
      else {
        const [assetId, versionId] = value.split("::");
        next[kind] = { assetId, versionId };
      }
      return { ...current, [proposal.id]: next };
    });
  };

  const confirmSelected = async () => {
    const rows = proposals.flatMap(proposal => {
      if (!selectedProposalIds.includes(proposal.id)) return [];
      const selections = overrides[proposal.id] ?? proposal.selections;
      if (!proposalCanBeConfirmed(proposal, selections)) return [];
      const modified = selectionKey(selections) !== selectionKey(proposal.selections);
      return [
        {
          stableShotId: proposal.stableShotId,
          selections,
          ...(modified ? {} : { sourceProposalId: proposal.id }),
        },
      ];
    });
    if (rows.length === 0) {
      toast.error("没有可确认的绑定；冲突项需先改绑");
      return;
    }
    try {
      await confirm.mutateAsync({
        storyId,
        expectedRevision: revision,
        operationToken: token("visual-confirm"),
        bindings: rows,
      });
      toast.success(`已确认 ${rows.length} 个镜头的视觉资产绑定`);
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "镜头绑定确认失败");
    }
  };

  const updateCurrentShotKind = (kind: VisualAssetKind, value: string) => {
    setCurrentShotSelection(current => {
      const next = { ...current };
      if (!value) delete next[kind];
      else {
        const [assetId, versionId] = value.split("::");
        next[kind] = { assetId, versionId };
      }
      return next;
    });
  };

  const confirmCurrentShot = async () => {
    if (!currentStableShotId) return;
    if (
      !currentShotSelection.character &&
      !currentShotSelection.pet &&
      !currentShotSelection.scene &&
      !currentShotSelection.style
    ) {
      toast.error("当前镜头至少选择一项资产");
      return;
    }
    try {
      await confirm.mutateAsync({
        storyId,
        expectedRevision: revision,
        operationToken: token("visual-confirm-shot"),
        bindings: [
          {
            stableShotId: currentStableShotId,
            selections: currentShotSelection,
          },
        ],
      });
      toast.success("当前镜头资产已关联；图片和视频生成将共同使用");
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "当前镜头资产关联失败");
    }
  };

  return (
    <details open={compact ? undefined : true}
      className="mb-2 rounded-lg border border-primary/30 bg-primary/5 p-2"
      aria-label="镜头资产绑定"
    >
      <summary className="cursor-pointer text-xs font-medium">整场默认参考 · {aggregate.defaultPet ? "已设置" : "未设置"} · 更多设置</summary>
      <div className="mb-2 mt-2 space-y-1" aria-label="整场戏默认宠物">
        {defaultError ? <p role="alert" className="text-xs text-destructive">{defaultError}</p> : null}
        <h3 className="text-sm font-semibold">整场戏用同一只宠物</h3>
        <p className="text-xs text-muted-foreground">默认参考用于下次渲染；有它出场时沿用，无需逐镜关联。</p>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="整场戏默认宠物" value={defaultPetKey} onChange={event => setDefaultPetKey(event.currentTarget.value)} className="h-10 min-w-0 max-w-full rounded-md border border-border bg-background px-3 text-sm">
            <option value="">未设置默认宠物</option>
            {defaultPetOptions.map(({ asset, version }) => <option key={version.id} value={`${asset.id}::${version.id}`}>{asset.name} · 版本 {version.version}</option>)}
          </select>
          <button type="button" onClick={() => void applyDefault()} disabled={saveDefault.isPending || (!defaultPetKey && !aggregate.defaultPet)} className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40">{saveDefault.isPending ? "正在保存…" : defaultPetKey || !aggregate.defaultPet ? "设为整场戏默认" : "取消整场戏默认"}</button>
        </div>
        {defaultPetOptions.length === 0 ? <p className="text-sm text-amber-700">生成宠物参考图后即可设为默认，无需先锁定。</p> : null}
        {aggregate.defaultPet ? <p className="text-xs text-primary">已设置整场戏默认。已有逐镜设置优先，保持原来的特殊安排。</p> : null}
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">单独设置某个镜头（可选）</summary>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="h-4 w-4 text-primary" /> 关联到镜头
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            AI 只提出建议。批量确认或逐镜改绑后，正式生成才会使用这些版本。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void ask()}
          disabled={propose.isPending || lockedOptions.length === 0}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 text-xs font-medium text-primary disabled:opacity-50"
        >
          {propose.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {proposals.length > 0 ? "重新生成建议" : "AI 建议镜头关联"}
        </button>
      </div>

      {lockedOptions.length === 0 ? (
        <p className="mt-2 text-sm text-amber-700">
          还没有已锁定资产。先在下方检查视图并点击“锁定此版本”，这里就能关联。
        </p>
      ) : null}
      {currentStableShotId ? (
        <div className="mt-3 rounded-md border border-primary/25 bg-background p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold">
                目标镜头 · {currentShotLabel ?? "当前选中镜头"}</div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                在这里关联一次；之后生成这镜的图片和视频都会自动携带同一版本。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void confirmCurrentShot()}
              disabled={confirm.isPending || lockedOptions.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {confirm.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              确认关联到镜头
            </button>
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row" aria-label="目标镜头内容">
            {currentShotContext?.imageUrl ? <img src={currentShotContext.imageUrl} alt={`目标镜头 ${currentShotLabel ?? ""} 当前画面`} className="h-36 w-48 shrink-0 rounded-md bg-muted object-contain" /> : <div className="flex h-28 w-48 shrink-0 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">这镜还没有当前画面</div>}
            <div className="min-w-0 space-y-2 text-sm">
              <p><span className="text-muted-foreground">旁白：</span>{currentShotContext?.dialogue || "无旁白"}</p>
              <p><span className="text-muted-foreground">画面动作：</span>{currentShotContext?.action || "未填写"}</p>
              {currentShotContext?.imagePrompt ? <details><summary className="cursor-pointer text-xs text-primary">查看完整图片要求</summary><p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{currentShotContext.imagePrompt}</p></details> : null}
            </div>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {VISUAL_ASSET_KINDS.map(kind => {
              const selected = currentShotSelection[kind];
              return (
                <label key={kind} className="text-[10px] text-muted-foreground">
                  {visualAssetKindLabel(kind)}
                  <select
                    value={selected ? `${selected.assetId}::${selected.versionId}` : ""}
                    onChange={event =>
                      updateCurrentShotKind(kind, event.currentTarget.value)
                    }
                    className="mt-1 h-8 w-full rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
                  >
                    <option value="">不关联</option>
                    {lockedOptions
                      .filter(option => option.asset.kind === kind)
                      .map(option => (
                        <option
                          key={option.version.id}
                          value={`${option.asset.id}::${option.version.id}`}
                        >
                          {option.asset.name} · 版本 {option.version.version}
                        </option>
                      ))}
                  </select>
                </label>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
          先在故事板选择一个镜头，再回来关联人物、宠物、场景和美术风格。
        </div>
      )}

      {proposals.length > 0 ? (
        <div className="mt-3 space-y-2">
          {proposals.map(proposal => {
            const selection = overrides[proposal.id] ?? proposal.selections;
            const canConfirm = proposalCanBeConfirmed(proposal, selection);
            return (
              <div key={proposal.id} className="rounded-md border border-border bg-background p-2.5">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedProposalIds.includes(proposal.id)}
                    disabled={!canConfirm}
                    onChange={event =>
                      setSelectedProposalIds(current =>
                        event.currentTarget.checked
                          ? Array.from(new Set([...current, proposal.id]))
                          : current.filter(id => id !== proposal.id)
                      )
                    }
                    aria-label={`选择 ${proposal.stableShotId}`}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold">{proposal.stableShotId}</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {VISUAL_ASSET_KINDS.map(kind => {
                        const selected = selection[kind];
                        return (
                          <label key={kind} className="text-[10px] text-muted-foreground">
                            {visualAssetKindLabel(kind)}
                            <select
                              value={selected ? `${selected.assetId}::${selected.versionId}` : ""}
                              onChange={event => updateKind(proposal, kind, event.currentTarget.value)}
                              className="mt-1 h-7 w-full rounded border border-border bg-background px-1 text-[11px] text-foreground"
                            >
                              <option value="">不关联</option>
                              {lockedOptions
                                .filter(option => option.asset.kind === kind)
                                .map(option => (
                                  <option
                                    key={option.version.id}
                                    value={`${option.asset.id}::${option.version.id}`}
                                  >
                                    {option.asset.name} · 版本 {" "}
                                    {option.version.version}
                                  </option>
                                ))}
                            </select>
                          </label>
                        );
                      })}
                    </div>
                    {Object.values(proposal.rationale).filter(Boolean).length > 0 ? (
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        {Object.values(proposal.rationale).filter(Boolean).join("；")}
                      </p>
                    ) : null}
                    {proposal.conflicts.length > 0 ? (
                      <div className="mt-2 rounded border border-amber-300/60 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800">
                        <div className="flex items-center gap-1 font-medium">
                          <AlertTriangle className="h-3 w-3" />{" "}
                          固定事实冲突，不能直接确认
                        </div>
                        {proposal.conflicts.map(conflict => (
                          <div key={`${conflict.kind}-${conflict.field}`} className="mt-0.5">
                            {conflict.field}：资产“{conflict.assetFact}” / 镜头“{conflict.shotRequest}”
                          </div>
                        ))}
                        {selectionKey(selection) !== selectionKey(proposal.selections) ? (
                          <div className="mt-1">已改绑；正式生成前仍会再次检查冲突。</div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void confirmSelected()}
              disabled={confirm.isPending || selectedProposalIds.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {confirm.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              批量确认 {selectedProposalIds.length} 镜
            </button>
          </div>
        </div>
      ) : aggregate.bindings.length > 0 ? (
        <div className="mt-3 text-xs text-muted-foreground">
          已确认 {aggregate.bindings.length}{" "}
          个镜头绑定。可重新生成建议并逐镜覆盖。
        </div>
      ) : null}
    </details>
    </details>
  );
}
