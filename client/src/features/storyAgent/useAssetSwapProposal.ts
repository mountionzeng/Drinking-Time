import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { estimateStoryboardImageCost } from "@shared/imageRenderCost";
import type {
  StoryVisualAsset,
  ShotVisualAssetBinding,
} from "@shared/visualAssets";
import type { SelectionContext } from "@shared/selectionContext";
import { readableRerenderError } from "@/features/creationEditor/rerender";
import { trpc } from "@/lib/trpc";
import {
  buildAssetSwapRenderPrompt,
  detectAssetSwapIntent,
  mergeAssetSwapSelection,
  looksLikeAssetSwap,
  describeAssetSwapProposal,
  type AssetSwapCandidate,
  type AssetSwapProposal,
} from "./assetSwapIntent";

type AssetSwapStatus =
  | "idle"
  /** 认出是换资产请求，但素材库还没拉回来，先接住别让它掉进通用改写。 */
  | "resolving"
  | "confirming"
  | "ambiguous"
  | "binding"
  | "rendering"
  | "done"
  | "error";

type AssetSwapResult = {
  imageId: number;
  imageUrl: string;
  shotLabel: string;
  /** 已经点过「用这张」——新图成了这一镜的当前画面。 */
  adopted: boolean;
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
  /** 把结果图定为这一镜的当前画面：时间轴和镜头设计表会同时换过来。 */
  adopt: () => Promise<void>;
  adopting: boolean;
  cancel: () => void;
};

/** 只有当前版本已锁定的资产才能绑定，也才该出现在提案里。 */
function lockedAssetCandidates(
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
  /**
   * 等到素材库回来后发现没有可用资产时，把这句话交还给通用改写路径。
   * 不接回去的话用户那条消息就凭空消失了。
   */
  onFallthrough?: (instruction: string) => void;
  /** 采用一张图作为所属镜头的当前画面（creationEditor.promoteStoryImage）。 */
  onAdoptImage?: (imageId: number) => Promise<void>;
  shotLabelOf: (
    shotNo: number | null | undefined,
    stableShotId?: string | null
  ) => string;
}): AssetSwapController {
  const [status, setStatus] = useState<AssetSwapStatus>("idle");
  const [proposal, setProposal] = useState<AssetSwapProposal | null>(null);
  const [candidates, setCandidates] = useState<AssetSwapCandidate[]>([]);
  const [pendingInstruction, setPendingInstruction] = useState("");
  const [result, setResult] = useState<AssetSwapResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);
  // 一次查询同时拿到 revision（绑定要做 CAS）、已锁定资产和已有绑定。
  const assetsQuery = trpc.visualAssets.read.useQuery(
    { storyId: input.storyId ?? 0 },
    { enabled: input.storyId != null && input.storyId > 0 }
  );
  const assets: StoryVisualAsset[] = assetsQuery.data?.aggregate.assets ?? [];
  const bindings: ShotVisualAssetBinding[] =
    assetsQuery.data?.aggregate.bindings ?? [];
  const storyRevision = assetsQuery.data?.revision ?? null;
  /** data 为 undefined 说明这一轮资产还没拉回来，此时的空列表不能当成「没有资产」。 */
  const assetsReady = assetsQuery.data !== undefined;
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
        estimatedCny: estimateStoryboardImageCost().estimatedCny,
        alreadyBound,
      };
    },
    [bindings, input]
  );

  /** 素材库已就绪时的正式判定。返回 false 表示这句话该交还给通用改写路径。 */
  const resolveIntent = useCallback(
    (instruction: string) => {
      const intent = detectAssetSwapIntent({
        instruction,
        lockedAssets: lockedAssetCandidates(assets),
      });
      if (intent.status === "none") return false;
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
    [assets, buildProposal]
  );

  const arm = useCallback(
    (instruction: string) => {
      const selection = input.selection;
      // 只在「选中了某一镜的画面」时接管；没有镜头就没有可绑的对象。
      if (!selection?.stableShotId) return false;
      // 先只看措辞。素材列表还没回来时也要认得出，否则会静默放行。
      if (!looksLikeAssetSwap(instruction)) return false;
      if (input.storyId == null) {
        toast.error("故事还没加载好，稍后再试");
        return false;
      }
      setError(null);
      setResult(null);
      bindTokenRef.current = operationToken("chat-asset-bind");
      setPendingInstruction(instruction);
      if (!assetsReady) {
        setCandidates([]);
        setProposal(null);
        setStatus("resolving");
        return true;
      }
      if (!resolveIntent(instruction)) {
        setStatus("idle");
        return false;
      }
      return true;
    },
    [assetsReady, input, resolveIntent]
  );

  // 等资产回来再补判。此时消息已经被接住了，判定不成立必须原样交还，
  // 否则用户那句话就凭空消失。
  useEffect(() => {
    if (status !== "resolving" || !assetsReady) return;
    const instruction = pendingInstruction;
    if (!resolveIntent(instruction)) {
      setStatus("idle");
      input.onFallthrough?.(instruction);
    }
  }, [assetsReady, input, pendingInstruction, resolveIntent, status]);

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
        const currentBinding = bindings.find(
          item => item.stableShotId === proposal.stableShotId
        );
        await bindMut.mutateAsync({
          storyId,
          expectedRevision: storyRevision,
          operationToken:
            bindTokenRef.current ?? operationToken("chat-asset-bind"),
          bindings: [
            {
              stableShotId: proposal.stableShotId,
              selections: mergeAssetSwapSelection({
                binding: currentBinding,
                kind: proposal.kind,
                replacement: {
                  assetId: proposal.asset.assetId,
                  versionId: proposal.asset.versionId,
                },
              }),
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
        // 绑定之后，镜头文字不能再描述这一维的身份：一致性闸门会把
        // 「把人换成…」判成「镜头文字要求改变已锁定的 character 事实」并整单拒绝。
        // 用户那句话已经由绑定本身执行掉了，不该再原样送进提示词。
        prompt: buildAssetSwapRenderPrompt(proposal),
        // 不传 imageProvider：资产链路目前只验证过默认供应商，
        // 传 gpt-image 会被 provider-role-unsupported 挡在付费之前。
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
        adopted: false,
      });
      setProposal(null);
      setStatus("done");
      bindTokenRef.current = null;
      void utils.storyAgent.storyMaterialState.invalidate({ storyId });
      void utils.storyAgent.storyImages.invalidate({ storyId });
      void utils.visualAssets.read.invalidate({ storyId });
    } catch (err) {
      setError(readableRerenderError(err));
      setStatus("error");
    }
  }, [bindings, bindMut, generateMut, input, proposal, status, storyRevision, utils]);

  /**
   * 「用这张」。重渲产物落库时 isCurrent 为 false —— 生成不等于采用
   * （功能账本 image-asset-history 的不变量：只有明确采用事件改变当前图片）。
   * 这一步就是那个明确事件；落下去之后时间轴和镜头设计表读同一份镜头数据，一起换。
   */
  const adopt = useCallback(async () => {
    if (!result || result.adopted || adopting) return;
    if (!input.onAdoptImage) {
      toast.error("当前页面无法直接采用，请到故事版上点这张的「已选」");
      return;
    }
    setAdopting(true);
    try {
      await input.onAdoptImage(result.imageId);
      setResult(current => (current ? { ...current, adopted: true } : current));
      toast.success(`${result.shotLabel} 已换成新画面`);
    } catch (err) {
      toast.error(readableRerenderError(err, "采用失败"));
    } finally {
      setAdopting(false);
    }
  }, [adopting, input, result]);

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
    adopt,
    adopting,
    cancel,
  };
}
