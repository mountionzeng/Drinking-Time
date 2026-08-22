import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { estimateStoryboardMaskedEditCost } from "@shared/imageRenderCost";
import type {
  StoryVisualAsset,
  ShotVisualAssetBinding,
} from "@shared/visualAssets";
import type { SelectionContext } from "@shared/selectionContext";
import { readableRerenderError } from "@/features/creationEditor/rerender";
import { trpc } from "@/lib/trpc";
import {
  assetKindLabel,
  detectAssetSwapIntent,
  describeAssetSwapProposal,
  type AssetSwapCandidate,
  type AssetSwapProposal,
} from "./assetSwapIntent";

export type AssetSwapStatus =
  | "idle"
  | "confirming"
  | "ambiguous"
  | "binding"
  | "rendering"
  | "done"
  | "error";

export type AssetSwapResult = {
  imageId: number;
  imageUrl: string;
  shotLabel: string;
};

export type AssetSwapController = {
  status: AssetSwapStatus;
  proposal: AssetSwapProposal | null;
  proposalText: string;
  candidates: AssetSwapCandidate[];
  result: AssetSwapResult | null;
  error: string | null;
  /** 返回 true 表示这句话被认成「用素材里的资产重画这一镜」，已经接管。 */
  arm: (instruction: string) => boolean;
  chooseCandidate: (assetId: string) => void;
  confirm: () => Promise<void>;
  cancel: () => void;
};

/** 只有当前版本已锁定的资产才能绑定，也才该出现在提案里。 */
export function lockedAssetCandidates(
  assets: readonly StoryVisualAsset[] | undefined
): AssetSwapCandidate[] {
  return (assets ?? []).flatMap(asset => {
    const version = asset.versions.find(
      item => item.id === asset.currentVersionId && item.status === "locked"
    );
    if (!version) return [];
    return [
      {
        assetId: asset.id,
        versionId: version.id,
        kind: asset.kind,
        assetName: asset.name,
        versionLabel: `版本 ${version.version}`,
      },
    ];
  });
}

function operationToken(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

/**
 * 「把这张图里的人换成素材里的那个人物」。
 *
 * 确认后两步：先 confirmBindings 把资产绑到这一镜（**持续生效**，不是只改这一次），
 * 再带 shotNo 重渲。带 shotNo 是关键 —— 服务端的资产解析卡在它上面
 * （storyAgent.ts 的 `shotIdentityForStoryShot(story, input.shotNo)`），
 * 不传就永远拿不到人物锚点，送进模型的只是一张裸图。
 */
export function useAssetSwapProposal(input: {
  storyId: number | null;
  selection: SelectionContext | null;
  shotLabelOf: (
    shotNo: number | null | undefined,
    stableShotId?: string | null
  ) => string;
  onRendered?: () => void;
}): AssetSwapController {
  const [status, setStatus] = useState<AssetSwapStatus>("idle");
  const [proposal, setProposal] = useState<AssetSwapProposal | null>(null);
  const [candidates, setCandidates] = useState<AssetSwapCandidate[]>([]);
  const [pendingInstruction, setPendingInstruction] = useState("");
  const [result, setResult] = useState<AssetSwapResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 一次查询同时拿到 revision（绑定要做 CAS）、已锁定资产和已有绑定。
  const assetsQuery = trpc.visualAssets.read.useQuery(
    { storyId: input.storyId ?? 0 },
    { enabled: input.storyId != null && input.storyId > 0 }
  );
  const assets: StoryVisualAsset[] = assetsQuery.data?.aggregate.assets ?? [];
  const bindings: ShotVisualAssetBinding[] =
    assetsQuery.data?.aggregate.bindings ?? [];
  const storyRevision = assetsQuery.data?.revision ?? null;
  const bindMut = trpc.visualAssets.confirmBindings.useMutation();
  const generateMut = trpc.storyAgent.generateForMobile.useMutation();
  const utils = trpc.useUtils();
  /**
   * 同一次操作重试必须复用同一个 token：服务端按回执复用已付费的结果，
   * 换新 token 等于重新全款购买。所以 token 存在 ref 上，只有开新提案时才换。
   */
  const bindTokenRef = useRef<string | null>(null);

  const buildProposal = useCallback(
    (
      instruction: string,
      asset: AssetSwapCandidate
    ): AssetSwapProposal | null => {
      const selection = input.selection;
      const stableShotId = selection?.stableShotId;
      if (!selection || !stableShotId) return null;
      const bound = bindings.find(item => item.stableShotId === stableShotId);
      const alreadyBound =
        bound?.[asset.kind]?.assetId === asset.assetId &&
        bound?.[asset.kind]?.versionId === asset.versionId;
      return {
        kind: asset.kind,
        asset,
        stableShotId,
        shotNo: selection.shotNo ?? null,
        shotLabel: input.shotLabelOf(selection.shotNo, stableShotId),
        imageId: selection.imageId ?? null,
        instruction,
        estimatedCny: estimateStoryboardMaskedEditCost().estimatedCny,
        alreadyBound,
      };
    },
    [bindings, input]
  );

  const arm = useCallback(
    (instruction: string) => {
      const selection = input.selection;
      // 只在「选中了某一镜的画面」时接管；没有镜头就没有可绑的对象。
      if (!selection?.stableShotId) return false;
      const lockedAssets = lockedAssetCandidates(assets);
      const intent = detectAssetSwapIntent({ instruction, lockedAssets });
      if (intent.status === "none") return false;
      if (input.storyId == null) {
        toast.error("故事还没加载好，稍后再试");
        return false;
      }
      setError(null);
      setResult(null);
      bindTokenRef.current = operationToken("chat-asset-bind");
      setPendingInstruction(instruction);
      if (intent.status === "ambiguous") {
        setCandidates(intent.candidates);
        setProposal(null);
        setStatus("ambiguous");
        return true;
      }
      const next = buildProposal(instruction, intent.asset);
      if (!next) return false;
      setCandidates([]);
      setProposal(next);
      setStatus("confirming");
      return true;
    },
    [assets, buildProposal, input]
  );

  const chooseCandidate = useCallback(
    (assetId: string) => {
      const asset = candidates.find(item => item.assetId === assetId);
      if (!asset) return;
      const next = buildProposal(pendingInstruction, asset);
      if (!next) return;
      setCandidates([]);
      setProposal(next);
      setStatus("confirming");
    },
    [buildProposal, candidates, pendingInstruction]
  );

  const cancel = useCallback(() => {
    setProposal(null);
    setCandidates([]);
    setError(null);
    setStatus("idle");
    bindTokenRef.current = null;
  }, []);

  const confirm = useCallback(async () => {
    const storyId = input.storyId;
    if (!proposal || storyId == null) return;
    if (status === "binding" || status === "rendering") return;
    try {
      if (!proposal.alreadyBound) {
        if (storyRevision == null) {
          setError("拿不到故事版本号，无法安全绑定，请刷新后再试");
          setStatus("error");
          return;
        }
        setStatus("binding");
        await bindMut.mutateAsync({
          storyId,
          expectedRevision: storyRevision,
          operationToken:
            bindTokenRef.current ?? operationToken("chat-asset-bind"),
          bindings: [
            {
              stableShotId: proposal.stableShotId,
              selections: {
                [proposal.kind]: {
                  assetId: proposal.asset.assetId,
                  versionId: proposal.asset.versionId,
                },
              },
            },
          ],
        });
      }
      setStatus("rendering");
      const response = await generateMut.mutateAsync({
        storyId,
        // 必须带 shotNo：服务端据此解析这一镜绑定的资产，拿到人物身份锚点。
        // 不传就走不到 resolveVisualAssetGenerationContext，送进模型的只是一张裸图。
        ...(proposal.shotNo != null ? { shotNo: proposal.shotNo } : {}),
        prompt: [
          `${proposal.shotLabel}：按已绑定的${assetKindLabel(proposal.kind)}资产重画这一镜。`,
          `用户要求（原话，严格执行）：`,
          proposal.instruction,
          `画面的地点、构图、机位和光线以当前这张图为准，只把${assetKindLabel(proposal.kind)}换成绑定的资产。`,
        ].join("\n"),
        explicitInstruction: proposal.instruction,
        imageProvider: "gpt-image",
        costConfirmation: {
          accepted: true,
          estimatedCny: proposal.estimatedCny,
        },
      });
      if (response.status !== "ok" || !response.imageId || !response.imageUrl) {
        setError(
          readableRerenderError(
            ("error" in response && response.error) || "",
            "图片生成没有返回结果"
          )
        );
        setStatus("error");
        return;
      }
      setResult({
        imageId: response.imageId,
        imageUrl: response.imageUrl,
        shotLabel: proposal.shotLabel,
      });
      setProposal(null);
      setStatus("done");
      bindTokenRef.current = null;
      void utils.storyAgent.storyMaterialState.invalidate({ storyId });
      void utils.storyAgent.storyImages.invalidate({ storyId });
      void utils.visualAssets.read.invalidate({ storyId });
      input.onRendered?.();
    } catch (err) {
      setError(readableRerenderError(err));
      setStatus("error");
    }
  }, [bindMut, generateMut, input, proposal, status, storyRevision, utils]);

  return {
    status,
    proposal,
    proposalText: proposal ? describeAssetSwapProposal(proposal) : "",
    candidates,
    result,
    error,
    arm,
    chooseCandidate,
    confirm,
    cancel,
  };
}
