import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Clipboard,
  Download,
  FilePenLine,
  GitBranch,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  MessageCircleMore,
  Pencil,
  Plus,
  RefreshCcw,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useStoryAgent,
  useStoryAgentActions,
} from "@/features/storyAgent/StoryAgentContext";
import { useStoryAgentChatSlice } from "@/features/storyAgent/spine/selectors";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import { trpc } from "@/lib/trpc";
import { optimizeImageForUpload } from "@/lib/imageUpload";
import {
  PUBLISHING_PLATFORM_REGISTRY,
  PUBLISHING_NARRATIVE_PURPOSES,
  computePublishingTextOperationRequestHash,
  defaultPublishingNarrativeIntent,
  getPublishingContentError,
  getXThreadStats,
  type PublishingDraftContent,
  type PublishingEditAssessment,
  type PublishingCoverArtReference,
  type PublishingCoverRound,
  type PublishingPlatformId,
  type PublishingNarrativeIntent,
  type PublishingNarrativePurpose,
  type PublishingStoryCoreContent,
  type PublishingTextOperationKind,
  type PublishingTextOperationScope,
  publishingNarrativePurposeLabel,
} from "@shared/publishingDraft";
import {
  estimatePublishingCoverCost,
  estimatePublishingCoverFallbackCost,
} from "@shared/imageRenderCost";
import { usePublishingPlatformSelection } from "./PublishingPlatformPicker";
import { downloadPublishingCover } from "./publishingCoverExport";
import {
  getCoverGenerationPresentation,
  shouldRecoverCoverGeneration,
  type CoverGenerationMode,
} from "./publishingCoverGenerationState";
import {
  buildPublishableText,
  existingPublishingTabs,
  getPublishingEditorContent,
  getPublishingStatus,
  publishingContentEquals,
  publishingConvertTargets,
  publishingErrorMessage,
  publishingStoryScopeMatches,
  publishingTextOperationScope,
  publishingTextOperationScopeMatches,
} from "./publishingDraftViewModel";

function createPublishingTextOperationIdentity(
  kind: PublishingTextOperationKind,
  scope: PublishingTextOperationScope,
  payload: unknown
) {
  const nonce = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    operationToken: `${kind}-${nonce}`,
    requestHash: computePublishingTextOperationRequestHash({ kind, scope, payload }),
  };
}

type PendingEditDecision = {
  platform: PublishingPlatformId;
  content: PublishingDraftContent;
  baseDraftRevision: number;
  assessment: PublishingEditAssessment;
  proposedCore: PublishingStoryCoreContent | null;
};

type PublishingCoverAssetView = {
  id: number;
  imageUrl: string;
  imageKey: string | null;
  shotIdentity: string | null;
  createdAt: Date;
};

type StoryScopedPublishingCover = {
  storyId: number;
  asset: PublishingCoverAssetView;
};

type PublishingCoverRoundView = PublishingCoverRound & {
  candidates: PublishingCoverAssetView[];
};

type StoryScopedPublishingCoverRounds = {
  storyId: number;
  rounds: PublishingCoverRoundView[];
};

type CoverArtDnaField = Exclude<
  keyof PublishingCoverArtReference,
  "label" | "imageUrl"
>;

type CoverReferenceAnalysisScope = {
  storyId: number | null;
  versionId: string;
};

export function isCurrentCoverReferenceAnalysis({
  requestId,
  currentRequestId,
  requestedScope,
  currentScope,
  activeStoryId,
}: {
  requestId: number;
  currentRequestId: number;
  requestedScope: CoverReferenceAnalysisScope;
  currentScope: CoverReferenceAnalysisScope;
  activeStoryId: number | null;
}): boolean {
  return (
    requestId === currentRequestId &&
    requestedScope.storyId != null &&
    requestedScope.storyId === currentScope.storyId &&
    requestedScope.versionId === currentScope.versionId &&
    publishingStoryScopeMatches(requestedScope.storyId, activeStoryId)
  );
}

const COVER_ART_DNA_FIELDS: Array<{
  key: CoverArtDnaField;
  label: string;
  placeholder: string;
}> = [
  { key: "style", label: "风格", placeholder: "如：纸本拼贴、表现主义绘画" },
  { key: "palette", label: "色彩", placeholder: "如：矿物色、局部高纯度红" },
  { key: "light", label: "光线", placeholder: "如：光成为实体、无明确光源" },
  { key: "composition", label: "构图", placeholder: "如：极端留白、失衡尺度" },
  { key: "material", label: "材质", placeholder: "如：粗纸纤维、透明树脂" },
  { key: "mood", label: "情绪", placeholder: "如：荒诞、温柔的不安" },
];

function uniqueCoverInstructions(values: string[]): string[] {
  const normalized = values
    .map(value => value.trim().slice(0, 2_000))
    .filter(Boolean);
  return normalized
    .filter((value, index) => normalized.lastIndexOf(value) === index)
    .slice(-20);
}

function instructionsFromRound(
  round: PublishingCoverRoundView | null | undefined
): string[] {
  return uniqueCoverInstructions([
    ...(round?.instructions ?? []),
    round?.feedback ?? "",
  ]);
}

function normalizeArtDnaValues(values: string[]): string[] {
  return Array.from(
    new Set(values.map(item => item.trim().slice(0, 300)).filter(Boolean))
  ).slice(0, 12);
}

function parseArtDnaInput(value: string): string[] {
  return normalizeArtDnaValues(value.split(/[\n,，、;；]+/));
}

function parseTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\s,，]+/)
        .map(tag => tag.trim().replace(/^#+/, ""))
        .filter(Boolean)
    )
  );
}

function ActionButton({
  children,
  onClick,
  disabled = false,
  primary = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-not-allowed disabled:opacity-45"
      style={
        primary
          ? {
              background: "var(--nayin-accent)",
              borderColor: "var(--nayin-accent)",
              color: "var(--background)",
            }
          : { borderColor: "var(--panel-border)" }
      }
    >
      {children}
    </button>
  );
}

export default function PublishingDraftWorkspace({
  onContinueToVideo,
}: {
  onContinueToVideo?: () => void;
}) {
  const { activeStoryId, publishing, publishingBuffers } = useStoryAgent();
  const { storyTitle } = useStoryAgentChatSlice();
  const {
    setPublishing,
    setPublishingBuffer,
    discardPublishingBuffer,
    ensureActiveStoryPersisted,
    loadStory,
  } = useStoryAgentActions();
  const selection = usePublishingPlatformSelection();
  const readQuery = trpc.publishingDraft.read.useQuery(
    { storyId: activeStoryId && activeStoryId > 0 ? activeStoryId : 1 },
    { enabled: Boolean(activeStoryId && activeStoryId > 0), retry: false }
  );
  const generateMut = trpc.publishingDraft.generate.useMutation();
  const convertMut = trpc.publishingDraft.convert.useMutation();
  const rewriteMut = trpc.publishingDraft.rewrite.useMutation();
  const repairFormattingMut = trpc.publishingDraft.repairFormatting.useMutation();
  const applyMut = trpc.publishingDraft.applyEdit.useMutation();
  const confirmWordingMut =
    trpc.publishingDraft.confirmWordingChange.useMutation();
  const confirmCoreMut = trpc.publishingDraft.confirmCoreChange.useMutation();
  const createVersionMut = trpc.publishingDraft.createVersion.useMutation();
  const selectVersionMut = trpc.publishingDraft.selectVersion.useMutation();
  const renameVersionMut = trpc.publishingDraft.renameVersion.useMutation();
  const generateCoverMut = trpc.publishingDraft.generateCover.useMutation();
  const adoptCoverMut = trpc.publishingDraft.adoptCoverCandidate.useMutation();
  const analyzeReferenceMut = trpc.artAgent.analyzeReference.useMutation();
  const buildVideoStoryboardMut =
    trpc.publishingDraft.buildVideoStoryboard.useMutation();
  const utils = trpc.useUtils();
  const [pendingDecision, setPendingDecision] =
    useState<PendingEditDecision | null>(null);
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [coverStudioOpen, setCoverStudioOpen] = useState(false);
  const [activeCoverRoundId, setActiveCoverRoundId] = useState<string | null>(
    null
  );
  const [selectedCoverAssetId, setSelectedCoverAssetId] = useState<
    number | null
  >(null);
  const [coverFeedback, setCoverFeedback] = useState("");
  const [coverInstructions, setCoverInstructions] = useState<string[]>([]);
  const [coverArtReference, setCoverArtReference] =
    useState<PublishingCoverArtReference | null>(null);
  const [coverReferencePreview, setCoverReferencePreview] = useState<
    string | null
  >(null);
  const coverReferenceInputRef = useRef<HTMLInputElement | null>(null);
  const coverReferenceAnalysisRequestRef = useRef(0);
  const coverReferenceAnalysisScopeRef = useRef<CoverReferenceAnalysisScope>({
    storyId: activeStoryId,
    versionId: publishing.activeVersionId ?? "v1",
  });
  const [coverGenerationMode, setCoverGenerationMode] =
    useState<CoverGenerationMode | null>(null);
  const coverGenerationInFlightRef = useRef(false);
  const recoveredCoverOperationRef = useRef<string | null>(null);
  const videoBuildInFlightRef = useRef(false);
  const videoBuildOperationRef = useRef<{
    scope: string;
    token: string;
  } | null>(null);
  const [generatedCover, setGeneratedCover] =
    useState<StoryScopedPublishingCover | null>(null);
  const [generatedCoverRounds, setGeneratedCoverRounds] =
    useState<StoryScopedPublishingCoverRounds | null>(null);
  const [pendingVersionId, setPendingVersionId] = useState<string | null>(null);
  const [newVersionName, setNewVersionName] = useState("");
  const [intentEditorOpen, setIntentEditorOpen] = useState(false);
  const [intentDraft, setIntentDraft] = useState<PublishingNarrativeIntent>(
    () => defaultPublishingNarrativeIntent()
  );
  const publishingStateRef = useRef(publishing);
  publishingStateRef.current = publishing;
  const versionId = publishing.activeVersionId ?? "v1";
  coverReferenceAnalysisScopeRef.current = {
    storyId: activeStoryId,
    versionId,
  };

  useEffect(() => {
    coverReferenceAnalysisRequestRef.current += 1;
    setCoverStudioOpen(false);
    setRewriteInstruction("");
    setActiveCoverRoundId(null);
    setSelectedCoverAssetId(null);
    setCoverFeedback("");
    setCoverInstructions([]);
    setCoverArtReference(null);
    setCoverReferencePreview(null);
    setCoverGenerationMode(null);
    coverGenerationInFlightRef.current = false;
    recoveredCoverOperationRef.current = null;
    videoBuildInFlightRef.current = false;
    videoBuildOperationRef.current = null;
    setGeneratedCover(null);
    setGeneratedCoverRounds(null);
  }, [activeStoryId, versionId]);

  useEffect(() => {
    const readData = readQuery.data;
    const remote = readData?.publishing;
    if (!readData || !remote || readData.storyId !== activeStoryId) return;
    if (
      remote.revision > publishing.revision ||
      (remote.revision === publishing.revision &&
        remote.updatedAt > publishing.updatedAt)
    ) {
      setPublishing(remote);
    }
  }, [
    activeStoryId,
    publishing.revision,
    publishing.updatedAt,
    readQuery.data,
    setPublishing,
  ]);

  const platform = publishing.activePlatform;
  const activeVersion =
    publishing.versions?.find(version => version.versionId === versionId) ??
    publishing.versions?.[0] ??
    null;
  const activeNarrativeIntent =
    activeVersion?.narrativeIntent ?? defaultPublishingNarrativeIntent();
  useEffect(() => setRewriteInstruction(""), [platform]);
  const adapter = PUBLISHING_PLATFORM_REGISTRY[platform];
  const draft = publishing.drafts[platform] ?? null;
  const editorContent =
    activeStoryId == null
      ? null
      : getPublishingEditorContent({
          state: publishing,
          buffers: publishingBuffers,
          storyId: activeStoryId,
          platform,
          versionId,
        });
  const dirty = Boolean(
    draft &&
      editorContent &&
      !publishingContentEquals(editorContent, draft.content)
  );
  const tabs = existingPublishingTabs(publishing);
  const convertTargets = publishingConvertTargets(publishing);
  const sourcePlatform =
    tabs.find(candidate => candidate !== platform) ?? tabs[0];
  const busy =
    generateMut.isPending ||
    convertMut.isPending ||
    rewriteMut.isPending ||
    repairFormattingMut.isPending ||
    applyMut.isPending ||
    confirmWordingMut.isPending ||
    confirmCoreMut.isPending ||
    createVersionMut.isPending ||
    selectVersionMut.isPending ||
    renameVersionMut.isPending;
  const coverBusy =
    coverGenerationMode !== null ||
    generateCoverMut.isPending ||
    adoptCoverMut.isPending ||
    analyzeReferenceMut.isPending;
  const videoPreparing = buildVideoStoryboardMut.isPending;
  const videoBusy = videoPreparing;
  const coverGenerationPresentation =
    getCoverGenerationPresentation(coverGenerationMode);
  const coverAsset =
    (generatedCover?.storyId === activeStoryId ? generatedCover.asset : null) ??
    (readQuery.data?.storyId === activeStoryId
      ? readQuery.data.coverAsset
      : null);
  const coverEstimate =
    readQuery.data?.coverEstimate ?? estimatePublishingCoverCost();
  const coverFallbackEstimate =
    readQuery.data?.coverFallbackEstimate ??
    estimatePublishingCoverFallbackCost();
  const coverRounds =
    generatedCoverRounds?.storyId === activeStoryId
      ? generatedCoverRounds.rounds
      : readQuery.data?.storyId === activeStoryId
        ? readQuery.data.coverRounds
        : [];
  const persistedCoverGeneration =
    readQuery.data?.storyId === activeStoryId
      ? readQuery.data.publishing.coverGeneration
      : null;
  const canUseCoverFallback =
    (persistedCoverGeneration?.status === "unknown" &&
      !persistedCoverGeneration.taskId &&
      (persistedCoverGeneration.provider ?? "midjourney") === "midjourney") ||
    (persistedCoverGeneration?.provider === "gpt-image" &&
      (persistedCoverGeneration.status === "failed" ||
        persistedCoverGeneration.status === "unknown"));
  const activeCoverRound =
    coverRounds.find(round => round.id === activeCoverRoundId) ??
    coverRounds.at(-1) ??
    null;
  const selectedCoverAsset =
    activeCoverRound?.candidates.find(
      candidate => candidate.id === selectedCoverAssetId
    ) ?? null;
  const status = draft ? getPublishingStatus(draft, dirty) : null;
  const contentError = editorContent
    ? getPublishingContentError(platform, editorContent)
    : null;
  const xThreadStats =
    platform === "x" && editorContent ? getXThreadStats(editorContent) : null;
  const statusStyle =
    status?.tone === "editing"
      ? "bg-amber-500/10 text-amber-700"
      : status?.tone === "review"
        ? "bg-rose-500/10 text-rose-700"
        : "bg-emerald-500/10 text-emerald-700";

  const replaceContent = (next: PublishingDraftContent) => {
    if (activeStoryId == null || !draft) return;
    if (publishingContentEquals(next, draft.content)) {
      discardPublishingBuffer(activeStoryId, platform, versionId);
      return;
    }
    setPublishingBuffer(activeStoryId, platform, next, versionId);
  };

  const generateOrConvert = async () => {
    if (activeStoryId == null || busy) return;
    try {
      const storyId = await ensureActiveStoryPersisted();
      if (publishing.core && sourcePlatform) {
        const scope = publishingTextOperationScope({
          storyId,
          state: publishing,
          platform,
          sourcePlatform,
        });
        const payload = { sourcePlatform, targetPlatform: platform };
        const identity = createPublishingTextOperationIdentity("convert", scope, payload);
        const result = await convertMut.mutateAsync({
          storyId,
          sourcePlatform,
          targetPlatform: platform,
          scope,
          ...identity,
        });
        if (
          !publishingStoryScopeMatches(
            storyId,
            storySpineStore.getState().activeStoryId
          )
        )
          return;
        if (!publishingTextOperationScopeMatches(result.operationScope, {
          storyId,
          state: publishingStateRef.current,
          platform: result.operationScope.platform,
          sourcePlatform: result.operationScope.sourcePlatform,
        })) return;
        setPublishing(result.publishing);
        if (result.status === "candidate") {
          setPublishingBuffer(storyId, platform, result.content, versionId);
        }
        toast.success(
          result.status === "candidate"
            ? `${adapter.label}已有稿件，转换结果已放入编辑器等待应用`
            : `已转换为 ${adapter.label}`
        );
      } else {
        const scope = publishingTextOperationScope({
          storyId,
          state: publishing,
          platform,
        });
        const payload = {
          activePlatform: platform,
          selectedPlatforms: publishing.selectedPlatforms,
        };
        const identity = createPublishingTextOperationIdentity("generate", scope, payload);
        const result = await generateMut.mutateAsync({
          storyId,
          activePlatform: platform,
          selectedPlatforms: publishing.selectedPlatforms,
          basePublishingRevision: publishing.revision,
          scope,
          ...identity,
        });
        if (
          !publishingStoryScopeMatches(
            storyId,
            storySpineStore.getState().activeStoryId
          )
        )
          return;
        if (!publishingTextOperationScopeMatches(result.operationScope, {
          storyId,
          state: publishingStateRef.current,
          platform: result.operationScope.platform,
          sourcePlatform: result.operationScope.sourcePlatform,
        })) return;
        setPublishing(result.publishing);
        toast.success(`${adapter.label}文字稿已生成`);
      }
    } catch (error) {
      toast.error(
        publishingErrorMessage(
          error,
          "文字稿生成失败，左侧对话和编辑内容都还在"
        )
      );
    }
  };

  const convertTo = async (targetPlatform: PublishingPlatformId) => {
    if (activeStoryId == null || !draft || busy) return;
    try {
      const storyId = await ensureActiveStoryPersisted();
      const scope = publishingTextOperationScope({
        storyId,
        state: publishing,
        platform: targetPlatform,
        sourcePlatform: platform,
      });
      const payload = { sourcePlatform: platform, targetPlatform };
      const identity = createPublishingTextOperationIdentity("convert", scope, payload);
      const result = await convertMut.mutateAsync({
        storyId,
        sourcePlatform: platform,
        targetPlatform,
        scope,
        ...identity,
      });
      if (
        !publishingStoryScopeMatches(
          storyId,
          storySpineStore.getState().activeStoryId
        )
      )
        return;
      if (!publishingTextOperationScopeMatches(result.operationScope, {
        storyId,
        state: publishingStateRef.current,
        platform: result.operationScope.platform,
        sourcePlatform: result.operationScope.sourcePlatform,
      })) return;
      setPublishing(result.publishing);
      if (result.status === "candidate") {
        setPublishingBuffer(storyId, targetPlatform, result.content, versionId);
      } else {
        discardPublishingBuffer(storyId, targetPlatform, versionId);
      }
      toast.success(
        result.status === "candidate"
          ? `${PUBLISHING_PLATFORM_REGISTRY[targetPlatform].label}已有稿件，候选已放入编辑器`
          : `已转为 ${PUBLISHING_PLATFORM_REGISTRY[targetPlatform].label}`
      );
    } catch (error) {
      toast.error(publishingErrorMessage(error, "平台转换失败，原稿没有变化"));
    }
  };

  const rewriteDraft = async () => {
    if (
      !draft ||
      !editorContent ||
      !rewriteInstruction.trim() ||
      activeStoryId == null ||
      busy
    ) {
      return;
    }
    const storyId = activeStoryId;
    try {
      const scope = publishingTextOperationScope({
        storyId,
        state: publishing,
        platform,
      });
      const payload = {
        instruction: rewriteInstruction.trim(),
        content: editorContent,
      };
      const identity = createPublishingTextOperationIdentity("rewrite", scope, payload);
      const result = await rewriteMut.mutateAsync({
        storyId,
        platform,
        instruction: rewriteInstruction.trim(),
        content: editorContent,
        baseDraftRevision: draft.revision,
        scope,
        ...identity,
      });
      if (
        !publishingStoryScopeMatches(
          storyId,
          storySpineStore.getState().activeStoryId
        )
      ) {
        return;
      }
      if (!publishingTextOperationScopeMatches(result.operationScope, {
        storyId,
        state: publishingStateRef.current,
        platform: result.operationScope.platform,
        sourcePlatform: result.operationScope.sourcePlatform,
      })) return;
      setPublishingBuffer(storyId, platform, result.content, versionId);
      setRewriteInstruction("");
      toast.success("改写预览已放进编辑器；看完后再决定是否应用");
    } catch (error) {
      toast.error(
        publishingErrorMessage(error, "文案改写失败，当前稿件没有变化")
      );
    }
  };

  const repairFormatting = async () => {
    if (!draft || !editorContent || activeStoryId == null || busy) return;
    const storyId = activeStoryId;
    try {
      const scope = publishingTextOperationScope({
        storyId,
        state: publishing,
        platform,
      });
      const payload = { content: editorContent };
      const identity = createPublishingTextOperationIdentity(
        "format_repair",
        scope,
        payload
      );
      const result = await repairFormattingMut.mutateAsync({
        storyId,
        platform,
        content: editorContent,
        baseDraftRevision: draft.revision,
        scope,
        ...identity,
      });
      if (!publishingStoryScopeMatches(
        storyId,
        storySpineStore.getState().activeStoryId
      )) return;
      if (!publishingTextOperationScopeMatches(result.operationScope, {
        storyId,
        state: publishingStateRef.current,
        platform: result.operationScope.platform,
        sourcePlatform: result.operationScope.sourcePlatform,
      })) return;
      replaceContent(result.content);
      toast.success(
        publishingContentEquals(result.content, editorContent)
          ? "当前格式已经符合平台要求"
          : "格式修复预览已放进编辑器；确认后再应用"
      );
    } catch (error) {
      toast.error(publishingErrorMessage(error, "格式修复失败，当前内容没有变化"));
    }
  };

  const applyChanges = async () => {
    if (!draft || !editorContent || !dirty || activeStoryId == null || busy)
      return;
    try {
      const storyId = await ensureActiveStoryPersisted();
      const result = await applyMut.mutateAsync({
        storyId,
        platform,
        content: editorContent,
        baseDraftRevision: draft.revision,
      });
      if (
        !publishingStoryScopeMatches(
          storyId,
          storySpineStore.getState().activeStoryId
        )
      )
        return;
      if (result.status === "applied") {
        setPublishing(result.publishing);
        discardPublishingBuffer(storyId, platform, versionId);
        toast.success("当前平台的修改已应用");
        return;
      }
      setPendingDecision({
        platform,
        content: editorContent,
        baseDraftRevision: draft.revision,
        assessment: result.assessment,
        proposedCore: result.proposedCore,
      });
    } catch (error) {
      toast.error(
        publishingErrorMessage(error, "修改暂时没有保存，编辑内容仍在")
      );
    }
  };

  const discardChanges = () => {
    if (!dirty || activeStoryId == null || busy) return;
    discardPublishingBuffer(activeStoryId, platform, versionId);
    setPendingDecision(null);
    setRewriteInstruction("");
    toast.success("已放弃这次修改，恢复到已应用版本");
  };

  const confirmAsWording = async () => {
    if (!pendingDecision || activeStoryId == null) return;
    const storyId = activeStoryId;
    try {
      const result = await confirmWordingMut.mutateAsync({
        storyId,
        platform: pendingDecision.platform,
        content: pendingDecision.content,
        baseDraftRevision: pendingDecision.baseDraftRevision,
      });
      if (
        !publishingStoryScopeMatches(
          storyId,
          storySpineStore.getState().activeStoryId
        )
      )
        return;
      setPublishing(result.publishing);
      discardPublishingBuffer(storyId, pendingDecision.platform, versionId);
      setPendingDecision(null);
      toast.success("只更新了当前平台的措辞");
    } catch (error) {
      toast.error(
        publishingErrorMessage(error, "修改暂时没有保存，编辑内容仍在")
      );
    }
  };

  const confirmAsCore = async () => {
    if (
      !pendingDecision?.proposedCore ||
      !publishing.core ||
      activeStoryId == null
    ) {
      return;
    }
    const storyId = activeStoryId;
    try {
      const result = await confirmCoreMut.mutateAsync({
        storyId,
        platform: pendingDecision.platform,
        content: pendingDecision.content,
        core: pendingDecision.proposedCore,
        baseCoreRevision: publishing.core.revision,
        baseDraftRevision: pendingDecision.baseDraftRevision,
      });
      if (
        !publishingStoryScopeMatches(
          storyId,
          storySpineStore.getState().activeStoryId
        )
      )
        return;
      setPublishing(result.publishing);
      setPendingDecision(null);
      toast.info("这次修改涉及故事内核，当前版本未被覆盖；请创建新版本继续，编辑内容已保留");
    } catch (error) {
      toast.error(
        publishingErrorMessage(error, "故事内核暂时没有更新，编辑内容仍在")
      );
    }
  };

  const copyText = async () => {
    if (!editorContent) return;
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("浏览器不允许访问剪贴板");
      await navigator.clipboard.writeText(
        buildPublishableText(editorContent, platform)
      );
      toast.success(`已复制 ${adapter.label} 文案`);
    } catch (error) {
      toast.error(publishingErrorMessage(error, "复制失败，请手动选择文案"));
    }
  };

  const openCoverStudio = () => {
    const latestRound = coverRounds.at(-1) ?? null;
    setActiveCoverRoundId(latestRound?.id ?? null);
    setSelectedCoverAssetId(null);
    setCoverFeedback("");
    setCoverInstructions(instructionsFromRound(latestRound));
    setCoverArtReference(latestRound?.artReference ?? null);
    setCoverReferencePreview(latestRound?.artReference?.imageUrl ?? null);
    setCoverStudioOpen(true);
  };

  const analyzeCoverArtReference = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      if (!file.type.startsWith("image/")) toast.error("请选择一张图片");
      return;
    }
    const storyId = activeStoryId;
    const capturedVersionId = versionId;
    const requestId = ++coverReferenceAnalysisRequestRef.current;
    const isCurrentRequest = () =>
      isCurrentCoverReferenceAnalysis({
        requestId,
        currentRequestId: coverReferenceAnalysisRequestRef.current,
        requestedScope: { storyId, versionId: capturedVersionId },
        currentScope: coverReferenceAnalysisScopeRef.current,
        activeStoryId: storySpineStore.getState().activeStoryId,
      });
    try {
      const optimized = await optimizeImageForUpload(file, {
        profile: "analysis",
      });
      const result = await analyzeReferenceMut.mutateAsync({
        imageBase64: optimized.base64,
        mimeType: optimized.mimeType,
        fileName: optimized.fileName,
        instruction:
          "只提取可迁移的美术语言，不要把图中的人物、物体、地点或情节当成生成内容。",
      });
      if (!isCurrentRequest()) return;
      const persistentImageUrl =
        !result.originalImageUrl.startsWith("data:") &&
        result.originalImageUrl.length <= 2_000
          ? result.originalImageUrl
          : undefined;
      setCoverArtReference({
        label: (file.name.trim() || "用户参考图").slice(0, 160),
        ...(persistentImageUrl ? { imageUrl: persistentImageUrl } : {}),
        style: normalizeArtDnaValues(result.analysis.visualStyle),
        palette: normalizeArtDnaValues(result.analysis.colorPalette),
        light: normalizeArtDnaValues(
          result.analysis.lighting ? [result.analysis.lighting] : []
        ),
        composition: normalizeArtDnaValues(
          result.analysis.composition ? [result.analysis.composition] : []
        ),
        material: normalizeArtDnaValues(
          result.analysis.materialsAndTextures ?? []
        ),
        mood: normalizeArtDnaValues(result.analysis.mood),
      });
      setCoverReferencePreview(optimized.dataUrl);
      toast.success("参考图已分析；你可以修改下面的美术 DNA");
    } catch (error) {
      if (!isCurrentRequest()) return;
      toast.error(
        publishingErrorMessage(error, "参考图分析失败，现有美术方向没有改变")
      );
    } finally {
      if (coverReferenceInputRef.current) {
        coverReferenceInputRef.current.value = "";
      }
    }
  };

  const updateCoverArtDna = (field: CoverArtDnaField, value: string) => {
    setCoverArtReference(current =>
      current ? { ...current, [field]: parseArtDnaInput(value) } : current
    );
  };

  const removeCoverInstruction = (index: number) => {
    setCoverInstructions(current =>
      current.filter((_, candidateIndex) => candidateIndex !== index)
    );
  };

  const updateCoverInstruction = (index: number, value: string) => {
    setCoverInstructions(current =>
      current.map((instruction, candidateIndex) =>
        candidateIndex === index ? value : instruction
      )
    );
  };

  const generateCover = async (
    mode: "fresh" | "revise",
    existingOperationToken?: string,
    provider: "midjourney" | "gpt-image" | "flux-schnell" = "midjourney"
  ) => {
    if (
      !draft ||
      dirty ||
      activeStoryId == null ||
      (!existingOperationToken && coverBusy) ||
      coverGenerationInFlightRef.current
    )
      return;
    if (mode === "revise" && !selectedCoverAsset && !existingOperationToken)
      return;
    const storyId = activeStoryId;
    const operationToken =
      existingOperationToken ?? `cover-${crypto.randomUUID()}`;
    const submittedInstructions = uniqueCoverInstructions([
      ...coverInstructions,
      coverFeedback,
    ]);
    coverGenerationInFlightRef.current = true;
    setCoverGenerationMode(mode);
    try {
      const result = await generateCoverMut.mutateAsync({
        storyId,
        platform,
        provider,
        basePublishingRevision: publishing.revision,
        referenceAssetId:
          mode === "revise" ? selectedCoverAsset?.id : undefined,
        feedback: coverFeedback.trim() || undefined,
        instructions: submittedInstructions,
        artReference: coverArtReference,
        operationToken,
        costConfirmation: {
          accepted: true,
          estimatedCny:
            provider === "midjourney"
              ? coverEstimate.estimatedCny
              : coverFallbackEstimate.estimatedCny,
        },
      });
      if (result.status === "confirmation_required") {
        toast.error(
          `费用预估已变化，请重新确认人民币 ¥${result.estimate.estimatedCny.toFixed(2)}`
        );
        return;
      }
      if (result.status === "error") {
        if (
          publishingStoryScopeMatches(
            storyId,
            storySpineStore.getState().activeStoryId
          )
        ) {
          setPublishing(result.publishing);
          utils.publishingDraft.read.setData({ storyId }, () => ({
            storyId,
            storyRevision: result.storyRevision,
            publishing: result.publishing,
            coverAsset: result.coverAsset,
            coverRounds: result.coverRounds,
            coverEstimate:
              provider === "midjourney"
                ? {
                    currency: result.estimate.currency,
                    estimatedCny: result.estimate.estimatedCny,
                    candidateCount: 4,
                  }
                : coverEstimate,
            coverFallbackEstimate:
              provider === "gpt-image"
                ? {
                    currency: result.estimate.currency,
                    estimatedCny: result.estimate.estimatedCny,
                    candidateCount: 1,
                  }
                : coverFallbackEstimate,
          }));
          setGeneratedCoverRounds({ storyId, rounds: result.coverRounds });
        }
        toast.error(result.error);
        return;
      }
      if (
        !publishingStoryScopeMatches(
          storyId,
          storySpineStore.getState().activeStoryId
        )
      )
        return;
      setPublishing(result.publishing);
      utils.publishingDraft.read.setData({ storyId }, () => {
        return {
          storyId,
          storyRevision: result.storyRevision,
          publishing: result.publishing,
          coverAsset: result.coverAsset,
          coverRounds: result.coverRounds,
          coverEstimate:
            provider === "midjourney"
              ? {
                  currency: result.estimate.currency,
                  estimatedCny: result.estimate.estimatedCny,
                  candidateCount: 4,
                }
              : coverEstimate,
          coverFallbackEstimate:
            provider === "gpt-image"
              ? {
                  currency: result.estimate.currency,
                  estimatedCny: result.estimate.estimatedCny,
                  candidateCount: 1,
                }
              : coverFallbackEstimate,
        };
      });
      setGeneratedCoverRounds({ storyId, rounds: result.coverRounds });
      setActiveCoverRoundId(result.coverRound.id);
      setSelectedCoverAssetId(null);
      setCoverInstructions(
        result.coverRound.instructions ?? submittedInstructions
      );
      setCoverArtReference(result.coverRound.artReference ?? coverArtReference);
      setCoverFeedback("");
      const flaggedCount = result.coverRound.qualityFlaggedAssetIds?.length ?? 0;
      toast.success(
        result.coverRound.qualityCheckUnavailable
          ? `新一轮 ${result.coverRound.candidates.length} 张候选已就绪，但本轮未经过像素质检，请自行确认有无文字`
          : flaggedCount > 0
            ? `新一轮 ${result.coverRound.candidates.length} 张候选已就绪，其中 ${flaggedCount} 张被标记为疑似含文字，正式封面没有改变`
            : `新一轮 ${result.coverRound.candidates.length} 张候选已就绪，正式封面没有改变`
      );
    } catch (error) {
      toast.error(
        publishingErrorMessage(error, "封面生成失败，原封面仍然保留")
      );
    } finally {
      coverGenerationInFlightRef.current = false;
      setCoverGenerationMode(current => (current === mode ? null : current));
      void utils.publishingDraft.read.invalidate({ storyId });
    }
  };

  useEffect(() => {
    if (
      !shouldRecoverCoverGeneration(persistedCoverGeneration) ||
      persistedCoverGeneration.versionId !== publishing.activeVersionId ||
      recoveredCoverOperationRef.current ===
        persistedCoverGeneration.operationToken ||
      coverGenerationInFlightRef.current
    ) {
      return;
    }
    recoveredCoverOperationRef.current =
      persistedCoverGeneration.operationToken;
    void generateCover(
      persistedCoverGeneration.referenceAssetId ? "revise" : "fresh",
      persistedCoverGeneration.operationToken,
      persistedCoverGeneration.provider ?? "midjourney"
    );
  }, [
    persistedCoverGeneration?.operationToken,
    persistedCoverGeneration?.error,
    persistedCoverGeneration?.status,
    persistedCoverGeneration?.taskId,
    persistedCoverGeneration?.versionId,
    publishing.activeVersionId,
  ]);

  const continueToVideo = async () => {
    if (
      activeStoryId == null ||
      coverBusy ||
      dirty ||
      videoBuildInFlightRef.current
    )
      return;
    const storyId = activeStoryId;
    const scope = `${storyId}:${versionId}`;
    const existingOperation = videoBuildOperationRef.current;
    const operationToken =
      existingOperation?.scope === scope
        ? existingOperation.token
        : `video-build-${crypto.randomUUID()}`;
    videoBuildOperationRef.current = { scope, token: operationToken };
    videoBuildInFlightRef.current = true;
    try {
      const result = await buildVideoStoryboardMut.mutateAsync({
        storyId,
        versionId,
        operationToken,
      });
      if (
        !publishingStoryScopeMatches(
          storyId,
          storySpineStore.getState().activeStoryId
        )
      ) {
        return;
      }
      setPublishing(result.publishing);
      utils.publishingDraft.read.setData({ storyId }, current =>
        current
          ? {
              ...current,
              storyRevision: result.storyRevision,
              publishing: result.publishing,
            }
          : current
      );
      if (result.status === "pending") {
        toast.info("故事版正在生成，稍后可用同一入口继续进入");
        return;
      }
      await Promise.all([
        utils.storyAgent.storyGet.invalidate({ id: storyId }),
        utils.storyAgent.storyImages.invalidate({ storyId }),
        utils.storyAgent.storyVideoAssets.invalidate({ storyId }),
        utils.storyAgent.storyMaterialState.invalidate({ storyId }),
      ]);
      await loadStory(storyId, {
        silent: true,
        expectedActiveStoryId: storyId,
      });
      videoBuildOperationRef.current = null;
      toast.success("故事版已生成，可以直接修改剧本、图片要求和视频要求");
      onContinueToVideo?.();
    } catch (error) {
      videoBuildOperationRef.current = null;
      toast.error(
        publishingErrorMessage(error, "故事版生成失败，原故事内容没有改变")
      );
    } finally {
      videoBuildInFlightRef.current = false;
    }
  };

  const adoptCoverCandidate = async (shouldContinueToVideo = false) => {
    if (!selectedCoverAsset || activeStoryId == null || coverBusy || dirty) {
      return;
    }
    const storyId = activeStoryId;
    try {
      const result = await adoptCoverMut.mutateAsync({
        storyId,
        assetId: selectedCoverAsset.id,
        basePublishingRevision: publishing.revision,
      });
      if (
        !publishingStoryScopeMatches(
          storyId,
          storySpineStore.getState().activeStoryId
        )
      ) {
        return;
      }
      setPublishing(result.publishing);
      utils.publishingDraft.read.setData({ storyId }, current => ({
        storyId,
        storyRevision: result.storyRevision,
        publishing: result.publishing,
        coverAsset: result.coverAsset,
        coverRounds: current?.coverRounds ?? coverRounds,
        coverEstimate: current?.coverEstimate ?? coverEstimate,
        coverFallbackEstimate:
          current?.coverFallbackEstimate ?? coverFallbackEstimate,
      }));
      setGeneratedCover({ storyId, asset: result.coverAsset });
      setCoverStudioOpen(false);
      setSelectedCoverAssetId(null);
      setCoverFeedback("");
      toast.success("已采用这张正式封面，其他工作区会继承它");
      if (shouldContinueToVideo) await continueToVideo();
    } catch (error) {
      toast.error(
        publishingErrorMessage(error, "封面采用失败，原封面仍然保留")
      );
    }
  };

  const downloadCover = async () => {
    if (!coverAsset || !editorContent) return;
    try {
      await downloadPublishingCover({
        imageUrl: coverAsset.imageUrl,
        platform,
        title: editorContent.title,
        storyTitle: storyTitle?.trim() || "文字稿",
      });
      toast.success(`已下载 ${adapter.label} 封面`);
    } catch (error) {
      toast.error(publishingErrorMessage(error, "封面下载失败，请稍后重试"));
    }
  };

  const refreshPublishingRead = async (storyId: number) => {
    const latest = await utils.publishingDraft.read.fetch({ storyId });
    if (
      publishingStoryScopeMatches(
        storyId,
        storySpineStore.getState().activeStoryId
      )
    ) {
      setPublishing(latest.publishing);
      utils.publishingDraft.read.setData({ storyId }, latest);
    }
    return latest;
  };

  const performVersionSwitch = async (targetVersionId: string) => {
    if (activeStoryId == null || targetVersionId === versionId) return;
    const target = publishing.versions?.find(
      candidate => candidate.versionId === targetVersionId
    );
    if (!target) return;
    try {
      const result = await selectVersionMut.mutateAsync({
        storyId: activeStoryId,
        versionId: targetVersionId,
        baseContainerRevision:
          publishing.containerRevision ?? publishing.revision,
        baseVersionRevision: target.versionRevision,
      });
      if (
        !publishingStoryScopeMatches(
          activeStoryId,
          storySpineStore.getState().activeStoryId
        )
      )
        return;
      setPublishing(result.publishing);
      await refreshPublishingRead(activeStoryId);
      setPendingDecision(null);
      setPendingVersionId(null);
      setRewriteInstruction("");
      setPendingDecision(null);
      toast.success(`已切换到 ${target.displayName}`);
    } catch (error) {
      toast.error(
        publishingErrorMessage(error, "版本切换失败，当前版本仍然保留")
      );
    }
  };

  const requestVersionSwitch = (targetVersionId: string) => {
    if (targetVersionId === versionId || busy) return;
    if (dirty) {
      setPendingVersionId(targetVersionId);
      return;
    }
    void performVersionSwitch(targetVersionId);
  };

  const keepBufferAndSwitchVersion = () => {
    if (!pendingVersionId) return;
    void performVersionSwitch(pendingVersionId);
  };

  const applyBufferAndSwitchVersion = async () => {
    if (
      !pendingVersionId ||
      !editorContent ||
      !draft ||
      activeStoryId == null
    ) {
      return;
    }
    try {
      const result = await applyMut.mutateAsync({
        storyId: activeStoryId,
        platform,
        content: editorContent,
        baseDraftRevision: draft.revision,
      });
      if (result.status !== "applied") {
        setPendingDecision({
          platform,
          content: editorContent,
          baseDraftRevision: draft.revision,
          assessment: result.assessment,
          proposedCore: result.proposedCore,
        });
        toast.error("这次修改涉及故事内核，请先在当前版本确认它");
        return;
      }
      setPublishing(result.publishing);
      discardPublishingBuffer(activeStoryId, platform, versionId);
      await performVersionSwitch(pendingVersionId);
    } catch (error) {
      toast.error(
        publishingErrorMessage(error, "修改没有保存，仍保留在当前版本")
      );
    }
  };

  const createVersion = async (narrativeIntent?: PublishingNarrativeIntent) => {
    if (
      activeStoryId == null ||
      !publishing.core ||
      !draft ||
      !editorContent ||
      dirty ||
      busy
    ) {
      if (dirty) toast.error("请先应用或保留当前未应用修改，再创建新版本");
      return;
    }
    const activeVersionRevision =
      activeVersion?.versionRevision ?? publishing.revision;
    try {
      const result = await createVersionMut.mutateAsync({
        storyId: activeStoryId,
        platform,
        core: publishing.core,
        content: editorContent,
        baseCoreRevision: publishing.core.revision,
        baseDraftRevision: draft.revision,
        baseVersionRevision: activeVersionRevision,
        baseContainerRevision:
          publishing.containerRevision ?? publishing.revision,
        displayName: newVersionName.trim() || undefined,
        narrativeIntent,
        operationToken: `create-${versionId}-${Date.now()}`,
      });
      if (
        !publishingStoryScopeMatches(
          activeStoryId,
          storySpineStore.getState().activeStoryId
        )
      )
        return;
      setPublishing(result.publishing);
      await refreshPublishingRead(activeStoryId);
      setNewVersionName("");
      toast.success(
        narrativeIntent
          ? "已按新用途创建版本，旧版本仍完整保留"
          : "已创建新版本，其他平台保留原稿并标记为待更新"
      );
    } catch (error) {
      toast.error(
        publishingErrorMessage(error, "新版本创建失败，当前版本没有变化")
      );
    }
  };

  const openIntentEditor = () => {
    setIntentDraft({
      ...activeNarrativeIntent,
      secondaryPurposes: [...activeNarrativeIntent.secondaryPurposes],
      secondaryAudiences: [...activeNarrativeIntent.secondaryAudiences],
    });
    setIntentEditorOpen(true);
  };

  const saveIntentAsNewVersion = async () => {
    const coreAudience = intentDraft.coreAudience.trim();
    if (!coreAudience) {
      toast.error("请写下这版最优先给谁看");
      return;
    }
    await createVersion({
      ...intentDraft,
      coreAudience,
      secondaryAudiences: intentDraft.secondaryAudiences
        .map(audience => audience.trim())
        .filter(Boolean)
        .filter(audience => audience !== coreAudience)
        .slice(0, 5),
      status: "confirmed",
      updatedAt: Date.now(),
    });
    setIntentEditorOpen(false);
  };

  const targetOptions = useMemo(
    () =>
      convertTargets.map(target => ({
        id: target,
        label: PUBLISHING_PLATFORM_REGISTRY[target].label,
      })),
    [convertTargets]
  );

  if (activeStoryId == null) {
    return (
      <section
        className="flex h-full items-center justify-center px-8"
        aria-label="文字稿空状态"
      >
        <div className="max-w-sm text-center">
          <MessageCircleMore className="mx-auto h-8 w-8 text-[var(--nayin-accent)]" />
          <h2 className="font-chat-brand mt-4 text-xl text-foreground">
            先从左侧打开一个故事
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            你可以继续讲自己的想法；只有点击生成后，文字稿才会出现在这里。
          </p>
        </div>
      </section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="h-full overflow-y-auto bg-[var(--nayin-surface-dim)]/45 p-3 sm:p-5"
      aria-label="文字稿工作区"
      data-story-panel="publishing-draft"
    >
      <div className="mx-auto flex min-h-full max-w-5xl flex-col">
        <header className="mb-3 flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Publishing Draft · {adapter.label}
            </p>
            <h1 className="font-chat-brand mt-1 text-xl text-foreground">
              {storyTitle?.trim() || "未命名故事"}
            </h1>
            <div
              className="mt-3 flex flex-wrap items-center gap-2"
              aria-label="故事发布版本"
              data-testid="publishing-version-selector"
            >
              <GitBranch className="h-3.5 w-3.5 text-[var(--nayin-accent)]" />
              <select
                value={versionId}
                onChange={event => requestVersionSwitch(event.target.value)}
                disabled={busy || (publishing.versions?.length ?? 0) < 2}
                className="h-8 rounded-md border bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-[var(--nayin-accent)]/25 disabled:opacity-60"
                style={{ borderColor: "var(--panel-border)" }}
                aria-label="选择发布版本"
              >
                {(publishing.versions ?? []).map(version => (
                  <option key={version.versionId} value={version.versionId}>
                    {version.displayName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={openIntentEditor}
                disabled={busy || !draft || !publishing.core || dirty}
                className="inline-flex h-8 max-w-[min(100%,19rem)] items-center gap-1.5 rounded-md border px-2 text-left text-[11px] text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/25 disabled:cursor-not-allowed disabled:opacity-55"
                style={{ borderColor: "var(--panel-border)" }}
                aria-label="修改这版的用途和观众"
                title="修改用途或观众会创建新版本，原版本不会改变"
              >
                <span className="truncate">
                  {publishingNarrativePurposeLabel(
                    activeNarrativeIntent.primaryPurpose
                  )}
                  {" · "}
                  {activeNarrativeIntent.coreAudience}
                  {activeNarrativeIntent.secondaryAudiences.length > 0
                    ? ` / ${activeNarrativeIntent.secondaryAudiences.join("、")}`
                    : ""}
                </span>
                <Pencil className="h-3 w-3 shrink-0 text-muted-foreground" />
              </button>
              <input
                value={newVersionName}
                onChange={event => setNewVersionName(event.target.value)}
                disabled={busy || !draft || !publishing.core || dirty}
                placeholder={`V${Math.max(0, ...(publishing.versions ?? []).map(v => v.sequence)) + 1}`}
                maxLength={80}
                className="h-8 w-28 rounded-md border bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-[var(--nayin-accent)]/25 disabled:opacity-60"
                style={{ borderColor: "var(--panel-border)" }}
                aria-label="新版本名称"
              />
              <ActionButton
                onClick={() => void createVersion()}
                disabled={busy || !draft || !publishing.core || dirty}
              >
                {createVersionMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                新建版本
              </ActionButton>
            </div>
          </div>
          <p className="max-w-md text-right text-[11px] leading-5 text-muted-foreground">
            AI 帮你整理结构和措辞，但事实、判断与锋芒仍属于你。
          </p>
        </header>

        <article
          className="relative flex min-h-[560px] flex-1 flex-col overflow-hidden rounded-xl border bg-background shadow-[0_20px_60px_-48px_rgba(55,42,25,0.55)]"
          style={{ borderColor: "var(--nayin-border)" }}
        >
          <div
            className="border-b px-4 pt-3"
            style={{ borderColor: "var(--panel-border)" }}
          >
            {tabs.length > 0 ? (
              <Tabs
                value={platform}
                onValueChange={value =>
                  selection.setActivePlatform(value as PublishingPlatformId)
                }
              >
                <TabsList className="max-w-full justify-start overflow-x-auto bg-transparent p-0 custom-scrollbar">
                  {tabs.map(tab => (
                    <TabsTrigger
                      key={tab}
                      value={tab}
                      className="shrink-0 rounded-none border-b-2 border-x-0 border-t-0 bg-transparent px-3 pb-2 text-xs shadow-none data-[state=active]:border-[var(--nayin-accent)] data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                    >
                      {PUBLISHING_PLATFORM_REGISTRY[tab].label}
                      {publishing.drafts[tab]?.needsReview ? (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-rose-500"
                          aria-label="建议复核"
                        />
                      ) : null}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : (
              <div className="pb-3 text-[11px] text-muted-foreground">
                尚未生成任何平台版本
              </div>
            )}
          </div>

          {!draft || !editorContent ? (
            <div className="flex flex-1 items-center justify-center px-6 py-16 text-center">
              <div className="max-w-md">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--nayin-glow)] text-[var(--nayin-accent)]">
                  <FilePenLine className="h-5 w-5" />
                </div>
                <h2 className="font-chat-brand mt-5 text-2xl text-foreground">
                  {publishing.core
                    ? `把现有内容转为 ${adapter.label}`
                    : "先聊清楚，再落笔"}
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                  {publishing.core
                    ? "只适配这个平台的篇幅、节奏和排版，不改变已经确认的内容内核。"
                    : "左侧对话只帮你厘清想法。系统不会判断“够了”就自动写稿，决定权在你。"}
                </p>
                <ActionButton
                  onClick={() => void generateOrConvert()}
                  disabled={busy}
                  primary
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {publishing.core
                    ? `转为 ${adapter.label}`
                    : `生成 ${adapter.label} 文字稿`}
                </ActionButton>
                {targetOptions.length > 0 ? (
                  <p className="mt-4 text-[11px] text-muted-foreground">
                    另外选择的{" "}
                    {targetOptions.map(item => item.label).join("、")}{" "}
                    不会在后台生成
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div
                className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3"
                style={{ borderColor: "var(--panel-border)" }}
              >
                <div className="flex items-center gap-2">
                  {status ? (
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-medium ${statusStyle}`}
                      role="status"
                    >
                      {status.label}
                    </span>
                  ) : null}
                  <span className="text-[10px] text-muted-foreground">
                    版本 {draft.revision} · 内核 {draft.sourceCoreRevision}
                  </span>
                </div>
                {draft.needsReview ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-rose-700">
                    <RefreshCcw className="h-3 w-3" />
                    请先复核，不会自动改写
                  </span>
                ) : null}
              </div>

              <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-6 sm:px-10 sm:py-8">
                <section
                  className="mb-7 border-b border-[var(--panel-border)] pb-5"
                  aria-label="按要求重写文案"
                >
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <p className="font-chat-brand text-base text-foreground">
                        这版不对？直接告诉我
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        先生成改写预览，不会直接保存，也不会自动改变你的核心观点。
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setRewriteInstruction(
                            "太矫情了。改得克制、直接，删掉空泛比喻和重复反问，保留我的判断。"
                          )
                        }
                        disabled={busy}
                        className="rounded-full border border-[var(--panel-border)] px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                      >
                        少点矫情
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setRewriteInstruction(
                            "压缩篇幅，先说结论，句子更短、更直接，不要营销口吻。"
                          )
                        }
                        disabled={busy}
                        className="rounded-full border border-[var(--panel-border)] px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                      >
                        更短更直接
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                    <textarea
                      value={rewriteInstruction}
                      onChange={event =>
                        setRewriteInstruction(event.target.value)
                      }
                      disabled={busy}
                      maxLength={2_000}
                      rows={2}
                      aria-label="告诉我怎么重写这篇文案"
                      placeholder="例如：太矫情了，改得克制直接一点，少用比喻，保留我的判断。"
                      className="min-h-[68px] flex-1 resize-y rounded-lg border border-[var(--panel-border)] bg-[var(--nayin-surface)]/45 px-3 py-2 text-xs leading-5 text-foreground outline-none focus:ring-2 focus:ring-[var(--nayin-accent)]/20 disabled:opacity-60"
                    />
                    <ActionButton
                      onClick={() => void repairFormatting()}
                      disabled={busy}
                    >
                      {repairFormattingMut.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCcw className="h-4 w-4" />
                      )}
                      只修格式
                    </ActionButton>
                    <ActionButton
                      onClick={() => void rewriteDraft()}
                      disabled={
                        busy ||
                        !rewriteInstruction.trim() ||
                        Boolean(contentError)
                      }
                      primary
                    >
                      {rewriteMut.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <MessageCircleMore className="h-4 w-4" />
                      )}
                      按要求重写
                    </ActionButton>
                  </div>
                </section>

                {platform === "x" ? (
                  <div className="rounded-md bg-[var(--nayin-surface)] px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                    X 不使用独立标题。长内容请用空行拆成
                    thread，复制时会自动逐条编号。
                  </div>
                ) : (
                  <>
                    <label
                      className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                      htmlFor="publishing-title"
                    >
                      标题
                    </label>
                    <input
                      id="publishing-title"
                      value={editorContent.title}
                      onChange={event =>
                        replaceContent({
                          ...editorContent,
                          title: event.target.value,
                        })
                      }
                      className="font-chat-brand mt-2 border-0 border-b bg-transparent px-0 pb-3 text-2xl text-foreground outline-none transition-colors focus:border-[var(--nayin-accent)]"
                      style={{ borderColor: "var(--panel-border)" }}
                      placeholder={`${adapter.label}标题（可留空）`}
                    />
                  </>
                )}

                <div className="mt-6 flex items-center justify-between gap-3">
                  <label
                    className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                    htmlFor="publishing-body"
                  >
                    正文
                  </label>
                  {xThreadStats ? (
                    <span
                      className={`text-[10px] ${contentError ? "text-rose-700" : "text-muted-foreground"}`}
                      role="status"
                    >
                      {xThreadStats.postCount} 条 thread · 最长{" "}
                      {xThreadStats.maxWeightedLength}/280
                    </span>
                  ) : null}
                </div>
                <textarea
                  id="publishing-body"
                  value={editorContent.body}
                  aria-invalid={Boolean(contentError)}
                  onChange={event =>
                    replaceContent({
                      ...editorContent,
                      body: event.target.value,
                    })
                  }
                  className="mt-2 min-h-[280px] flex-1 resize-y border-0 bg-transparent p-0 text-[15px] leading-8 text-foreground outline-none"
                  placeholder="你的正文会出现在这里…"
                />
                {contentError ? (
                  <p className="mt-2 text-[11px] text-rose-700">
                    {contentError}
                  </p>
                ) : null}

                <label
                  className="mt-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                  htmlFor="publishing-tags"
                >
                  话题标签
                </label>
                <input
                  id="publishing-tags"
                  value={editorContent.tags
                    .map(tag => `#${tag.replace(/^#+/, "")}`)
                    .join(" ")}
                  onChange={event =>
                    replaceContent({
                      ...editorContent,
                      tags: parseTags(event.target.value),
                    })
                  }
                  className="mt-2 rounded-md border bg-transparent px-3 py-2 text-xs text-muted-foreground outline-none focus:ring-2 focus:ring-[var(--nayin-accent)]/20"
                  style={{ borderColor: "var(--panel-border)" }}
                  placeholder="#话题（可选）"
                />

                <section
                  className="mt-7 overflow-hidden rounded-lg border"
                  style={{ borderColor: "var(--panel-border)" }}
                  aria-label="社交封面"
                >
                  <div
                    className="flex items-center justify-between gap-3 border-b px-3 py-2"
                    style={{ borderColor: "var(--panel-border)" }}
                  >
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        社交封面
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        四图候选 · 对话修改 · 明确采用；正式图为原生 3:4
                      </p>
                    </div>
                    {coverAsset ? (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-700">
                        正式封面已采用
                      </span>
                    ) : null}
                  </div>
                  {coverAsset ? (
                    <div className="grid gap-3 p-3 sm:grid-cols-[112px_1fr] sm:items-center">
                      <img
                        src={coverAsset.imageUrl}
                        alt="当前发布封面主视觉"
                        className="aspect-[3/4] w-28 rounded-md object-cover"
                      />
                      <div>
                        <p className="text-xs font-medium text-foreground">
                          同一张图适配所有平台
                        </p>
                        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                          下载时才按平台比例居中裁切并加入当前标题，不会再次调用图片模型。
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 p-3 text-[11px] leading-5 text-muted-foreground">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--nayin-surface)]">
                        <ImageIcon className="h-4 w-4 text-[var(--nayin-accent)]" />
                      </div>
                      先生成一轮 4
                      张候选。选择、查看和采用都不收费；只有明确生成新一轮才会产生图片费用。
                    </div>
                  )}
                </section>
              </div>

              <footer
                className="flex flex-wrap items-center gap-2 border-t bg-[var(--nayin-surface)]/45 px-4 py-3"
                style={{ borderColor: "var(--panel-border)" }}
              >
                <ActionButton
                  onClick={() => void applyChanges()}
                  disabled={!dirty || busy || Boolean(contentError)}
                  primary
                >
                  {applyMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  应用修改
                </ActionButton>
                {dirty ? (
                  <ActionButton onClick={discardChanges} disabled={busy}>
                    <Undo2 className="h-4 w-4" />
                    放弃修改
                  </ActionButton>
                ) : null}
                <ActionButton
                  onClick={() => void copyText()}
                  disabled={busy || Boolean(contentError)}
                >
                  <Clipboard className="h-4 w-4" />
                  复制文案
                </ActionButton>
                <ActionButton
                  onClick={openCoverStudio}
                  disabled={busy || coverBusy || videoBusy || dirty}
                >
                  {coverBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImageIcon className="h-4 w-4" />
                  )}
                  {coverRounds.length > 0 ? "继续选封面" : "打开封面工作室"}
                </ActionButton>
                {coverAsset ? (
                  <ActionButton
                    onClick={() => void downloadCover()}
                    disabled={busy || coverBusy}
                  >
                    <Download className="h-4 w-4" />
                    下载 {adapter.shortLabel} 封面
                  </ActionButton>
                ) : null}
                {targetOptions.map(target => (
                  <ActionButton
                    key={target.id}
                    onClick={() => void convertTo(target.id)}
                    disabled={busy || dirty}
                  >
                    一键转为 {target.label}
                  </ActionButton>
                ))}
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                  {videoPreparing ? (
                    <span
                      className="text-[11px] text-muted-foreground"
                      role="status"
                      aria-live="polite"
                    >
                      正在生成剧本、图片要求和视频要求，完成后会直接打开故事版…
                    </span>
                  ) : null}
                  <ActionButton
                    onClick={() => void continueToVideo()}
                    disabled={busy || videoBusy || dirty}
                    primary={Boolean(coverAsset)}
                  >
                    {videoPreparing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        正在生成故事版…
                      </>
                    ) : (
                      <>
                        进入视频制作
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </ActionButton>
                </div>
              </footer>
            </div>
          )}
        </article>
      </div>

      <Dialog open={intentEditorOpen} onOpenChange={setIntentEditorOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>这版故事想完成什么</DialogTitle>
            <DialogDescription>
              修改用途或观众会新建一个版本；当前文字、封面和故事版都不会被覆盖。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1 text-sm">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground">
                主用途
              </span>
              <select
                value={intentDraft.primaryPurpose}
                onChange={event => {
                  const primaryPurpose = event.target
                    .value as PublishingNarrativePurpose;
                  setIntentDraft(current => ({
                    ...current,
                    primaryPurpose,
                    secondaryPurposes: current.secondaryPurposes.filter(
                      purpose => purpose !== primaryPurpose
                    ),
                  }));
                }}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--nayin-accent)]/25"
                style={{ borderColor: "var(--panel-border)" }}
              >
                {PUBLISHING_NARRATIVE_PURPOSES.map(purpose => (
                  <option key={purpose} value={purpose}>
                    {publishingNarrativePurposeLabel(purpose)}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium text-foreground">
                兼顾用途
              </legend>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                {PUBLISHING_NARRATIVE_PURPOSES.filter(
                  purpose => purpose !== intentDraft.primaryPurpose
                ).map(purpose => (
                  <label
                    key={purpose}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={intentDraft.secondaryPurposes.includes(purpose)}
                      onChange={event =>
                        setIntentDraft(current => ({
                          ...current,
                          secondaryPurposes: event.target.checked
                            ? [...current.secondaryPurposes, purpose].slice(
                                0,
                                4
                              )
                            : current.secondaryPurposes.filter(
                                item => item !== purpose
                              ),
                        }))
                      }
                    />
                    {publishingNarrativePurposeLabel(purpose)}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground">
                最优先给谁看
              </span>
              <input
                value={intentDraft.coreAudience}
                onChange={event =>
                  setIntentDraft(current => ({
                    ...current,
                    coreAudience: event.target.value,
                  }))
                }
                maxLength={80}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--nayin-accent)]/25"
                style={{ borderColor: "var(--panel-border)" }}
                placeholder="例如：妈妈、招聘者、正在经历同样困惑的人"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground">
                还要兼顾谁（用顿号或逗号分开）
              </span>
              <input
                value={intentDraft.secondaryAudiences.join("、")}
                onChange={event =>
                  setIntentDraft(current => ({
                    ...current,
                    secondaryAudiences: event.target.value
                      .split(/[、,，]/)
                      .map(value => value.trim())
                      .filter(Boolean)
                      .slice(0, 5),
                  }))
                }
                maxLength={400}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--nayin-accent)]/25"
                style={{ borderColor: "var(--panel-border)" }}
                placeholder="例如：朋友圈朋友"
              />
            </label>
          </div>
          <DialogFooter>
            <ActionButton onClick={() => setIntentEditorOpen(false)}>
              取消
            </ActionButton>
            <ActionButton
              onClick={() => void saveIntentAsNewVersion()}
              disabled={busy}
              primary
            >
              按这个目的新建版本
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingVersionId)}
        onOpenChange={open => !open && setPendingVersionId(null)}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>当前版本还有未应用修改</DialogTitle>
            <DialogDescription>
              切换到其他版本前，选择如何处理这份修改。保留后它会留在当前版本，稍后可以回来继续应用。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPendingVersionId(null)}
              disabled={busy}
              className="h-9 rounded-md px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              取消
            </button>
            <ActionButton onClick={keepBufferAndSwitchVersion} disabled={busy}>
              保留稍后处理
            </ActionButton>
            <ActionButton
              onClick={() => void applyBufferAndSwitchVersion()}
              disabled={busy || Boolean(contentError)}
              primary
            >
              {applyMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              应用并切换
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingDecision)}
        onOpenChange={open => !open && setPendingDecision(null)}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>这次改的是措辞，还是内核？</DialogTitle>
            <DialogDescription>
              {pendingDecision?.assessment.reason ||
                "这处修改可能改变了你的核心观点，需要由你决定。"}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-[var(--nayin-surface)] px-3 py-2 text-xs leading-5 text-muted-foreground">
            选择“只改当前平台”不会影响其他版本；更新故事内核后，其他平台只会标记为建议复核，不会被自动重写。
          </div>
          {pendingDecision?.assessment.outcome === "uncertain" ? (
            <p className="text-xs leading-5 text-muted-foreground">
              如果你的事实或观点确实变了，请先回到左侧告诉聊聊变化在哪里；如果只是想换一种说法，直接保留在当前平台即可。
            </p>
          ) : null}
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPendingDecision(null)}
              disabled={busy}
              className="h-9 rounded-md px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              回到稿件
            </button>
            <ActionButton
              onClick={() => void confirmAsWording()}
              disabled={busy}
            >
              只改当前平台
            </ActionButton>
            {pendingDecision?.proposedCore ? (
              <ActionButton
                onClick={() => void confirmAsCore()}
                disabled={busy}
                primary
              >
                更新故事内核
              </ActionButton>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={coverStudioOpen}
        onOpenChange={open => !coverBusy && setCoverStudioOpen(open)}
      >
        <DialogContent
          showCloseButton={!coverBusy}
          className="max-h-[92vh] overflow-y-auto border-[var(--panel-border)] bg-[var(--background)] p-0 sm:max-w-4xl"
        >
          <DialogHeader>
            <div className="border-b border-[var(--panel-border)] px-5 pb-4 pt-5 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3 pr-7">
                <div>
                  <DialogTitle className="font-chat-brand text-xl">
                    封面工作室
                  </DialogTitle>
                  <DialogDescription className="mt-1 max-w-2xl text-xs leading-5">
                    一次生成 4
                    张粗选图，全部展示；像素质检只把疑似含文字的标出来，不替你丢弃。你可以选一张，在这里直接说怎么改；只有点击“采用这张”后，它才会成为正式封面。
                  </DialogDescription>
                </div>
                <div className="rounded-full border border-[var(--panel-border)] bg-[var(--nayin-surface)] px-3 py-1.5 text-[10px] text-muted-foreground">
                  新一轮 ¥{coverEstimate.estimatedCny.toFixed(2)} · 含像素质检 ·
                  选择与采用免费
                </div>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-5 px-5 pb-2 sm:px-6">
            {coverAsset ? (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-600/15 bg-emerald-500/[0.06] p-3">
                <img
                  src={coverAsset.imageUrl}
                  alt="目前使用中的正式封面"
                  className="h-14 w-11 rounded-md object-cover"
                />
                <div>
                  <p className="text-xs font-medium text-foreground">
                    探索期间，原正式封面会一直保留
                  </p>
                  <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                    下游工作区现在仍读取这张图，候选不会提前混进去。
                  </p>
                </div>
              </div>
            ) : null}

            {coverRounds.length > 0 ? (
              <div
                className="flex gap-2 overflow-x-auto pb-1"
                aria-label="封面候选轮次"
              >
                {coverRounds.map((round, index) => {
                  const active = round.id === activeCoverRound?.id;
                  return (
                    <button
                      type="button"
                      key={round.id}
                      onClick={() => {
                        setActiveCoverRoundId(round.id);
                        setSelectedCoverAssetId(null);
                        setCoverFeedback("");
                      }}
                      disabled={coverBusy}
                      aria-pressed={active}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-[10px] font-medium transition-colors disabled:opacity-50 ${
                        active
                          ? "border-[var(--nayin-accent)] bg-[var(--nayin-accent)]/10 text-foreground"
                          : "border-[var(--panel-border)] text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      第 {index + 1} 轮
                    </button>
                  );
                })}
              </div>
            ) : null}

            {activeCoverRound ? (
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    选择一个方向
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {activeCoverRound.parentAssetId
                      ? "这一轮基于上一张候选修改"
                      : "这一轮从故事内核重新构思"}
                  </p>
                </div>
                <div
                  role="radiogroup"
                  aria-label="本轮封面候选"
                  className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4"
                >
                  {activeCoverRound.candidates.map((candidate, index) => {
                    const selected = candidate.id === selectedCoverAsset?.id;
                    const flagged = (
                      activeCoverRound.qualityFlaggedAssetIds ?? []
                    ).includes(candidate.id);
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={`选择第 ${index + 1} 张封面候选`}
                        disabled={coverBusy}
                        onClick={() =>
                          setSelectedCoverAssetId(
                            selected ? null : candidate.id
                          )
                        }
                        className={`group relative overflow-hidden rounded-xl border-2 bg-[var(--nayin-surface)] text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/40 disabled:opacity-60 ${
                          selected
                            ? "border-[var(--nayin-accent)] shadow-[0_12px_32px_rgba(132,99,38,0.16)]"
                            : "border-transparent hover:border-[var(--panel-border)]"
                        }`}
                      >
                        <img
                          src={candidate.imageUrl}
                          alt={`第 ${index + 1} 张封面候选`}
                          className="aspect-[3/4] w-full object-cover transition-transform duration-300 group-hover:scale-[1.015]"
                        />
                        <span className="absolute left-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-black/55 px-1.5 text-[10px] font-medium text-white backdrop-blur-sm">
                          {selected ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            index + 1
                          )}
                        </span>
                        {flagged ? (
                          <span
                            title="像素质检怀疑这张有文字、Logo 或水印，仅作提示，你仍然可以采用"
                            className="absolute right-2 top-2 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm"
                          >
                            疑似文字
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {activeCoverRound.qualityCheckUnavailable ? (
                  <p className="mt-2 text-[11px] leading-5 text-amber-700">
                    本轮没有经过像素质检（质检通道当时不可用），画面里的文字、Logo
                    或水印不会被标出来，请自己确认后再采用。
                  </p>
                ) : (activeCoverRound.qualityFlaggedAssetIds?.length ?? 0) > 0 ? (
                  <p className="mt-2 text-[11px] leading-5 text-amber-700">
                    {`本轮 ${activeCoverRound.candidates.length} 张全部保留可选；其中 ${activeCoverRound.qualityFlaggedAssetIds!.length} 张被像素质检标记为疑似含文字、Logo 或水印，仅作提示，是否采用由你决定。`}
                  </p>
                ) : (activeCoverRound.qualityRejectedCount ?? 0) > 0 ? (
                  <p className="mt-2 text-[11px] leading-5 text-amber-700">
                    {`这是早期轮次：当时有 ${activeCoverRound.qualityRejectedCount} 张因检测到文字、Logo 或水印被隔离，未保留。`}
                  </p>
                ) : activeCoverRound.candidates.length !==
                  activeCoverRound.assetIds.length ? (
                  <p className="mt-2 text-[11px] text-rose-700">
                    这一轮有图片资产暂时不可用，你仍可查看其他轮次或重新生成。
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--panel-border)] bg-[var(--nayin-surface)]/55 px-6 py-10 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[var(--nayin-accent)]/10 text-[var(--nayin-accent)]">
                  <Sparkles className="h-5 w-5" />
                </div>
                <p className="font-chat-brand mt-3 text-base text-foreground">
                  先看四个方向，再决定哪张值得留下
                </p>
                <p className="mx-auto mt-1.5 max-w-md text-[11px] leading-5 text-muted-foreground">
                  Midjourney 会生成 4 张原生 3:4
                  候选。每张都会在展示前检查文字、乱码、Logo、账号与水印；污染候选不会进入可选轮次，最终审美仍由你决定。
                </p>
              </div>
            )}

            <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--nayin-surface)]/55 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    美术参考图 · 可选
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                    系统只提取风格、色彩、光线、构图与材质，不复制图中的人物和内容。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => coverReferenceInputRef.current?.click()}
                  disabled={coverBusy}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--panel-border)] px-2.5 text-[10px] font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                >
                  {analyzeReferenceMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )}
                  {coverArtReference ? "更换参考图" : "上传参考图"}
                </button>
                <input
                  ref={coverReferenceInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={event => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void analyzeCoverArtReference(file);
                  }}
                />
              </div>

              {coverArtReference ? (
                <div className="mt-3 space-y-2.5">
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--background)] p-2">
                    {coverReferencePreview || coverArtReference.imageUrl ? (
                      <img
                        src={
                          coverReferencePreview || coverArtReference.imageUrl
                        }
                        alt={coverArtReference.label}
                        className="h-12 w-12 rounded-md object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-[var(--nayin-surface)] text-muted-foreground">
                        <ImageIcon className="h-4 w-4" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium text-foreground">
                        {coverArtReference.label}
                      </p>
                      <p className="mt-0.5 text-[9px] text-muted-foreground">
                        以下是将参与生成的美术 DNA，可直接改写或清空。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCoverArtReference(null);
                        setCoverReferencePreview(null);
                      }}
                      disabled={coverBusy}
                      aria-label="移除封面美术参考图"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-700 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {COVER_ART_DNA_FIELDS.map(field => (
                      <label
                        key={field.key}
                        className="grid grid-cols-[40px_1fr] items-center gap-2 text-[9px] font-medium text-muted-foreground"
                      >
                        <span>{field.label}</span>
                        <input
                          value={coverArtReference[field.key].join("、")}
                          onChange={event =>
                            updateCoverArtDna(field.key, event.target.value)
                          }
                          disabled={coverBusy}
                          placeholder={field.placeholder}
                          className="h-8 min-w-0 rounded-md border border-[var(--panel-border)] bg-[var(--background)] px-2 text-[10px] text-foreground outline-none placeholder:text-muted-foreground/55 focus:ring-2 focus:ring-[var(--nayin-accent)]/20 disabled:opacity-60"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--nayin-surface)]/55 p-3.5">
              <label
                htmlFor="publishing-cover-feedback"
                className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground"
              >
                本轮补充要求 · 两个生成按钮都会参考
              </label>
              <textarea
                id="publishing-cover-feedback"
                value={coverFeedback}
                onChange={event => setCoverFeedback(event.target.value)}
                disabled={coverBusy}
                maxLength={2_000}
                rows={3}
                className="mt-2 w-full resize-none rounded-lg border border-[var(--panel-border)] bg-[var(--background)] px-3 py-2.5 text-xs leading-5 text-foreground outline-none transition-shadow placeholder:text-muted-foreground/65 focus:ring-2 focus:ring-[var(--nayin-accent)]/20 disabled:opacity-60"
                placeholder={
                  selectedCoverAsset
                    ? "例如：去掉画面里的字体，让人物更小、机器更压迫……"
                    : "例如：不要海报感，不要任何文字；让空间更陌生，材质更有想象力。"
                }
              />
              {coverInstructions.length > 0 ? (
                <div className="mt-2.5">
                  <p className="text-[9px] font-medium text-muted-foreground">
                    后续每一轮都会继续参考
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {coverInstructions.map((instruction, index) => (
                      <span
                        key={index}
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--panel-border)] bg-[var(--background)] py-1 pl-2.5 pr-1 text-[10px] text-foreground"
                      >
                        <input
                          value={instruction}
                          onChange={event =>
                            updateCoverInstruction(index, event.target.value)
                          }
                          onBlur={() =>
                            setCoverInstructions(current =>
                              uniqueCoverInstructions(current)
                            )
                          }
                          disabled={coverBusy}
                          aria-label={`持续要求 ${index + 1}`}
                          className="min-w-[72px] max-w-[260px] bg-transparent outline-none disabled:opacity-60"
                          style={{
                            width: `${Math.min(30, Math.max(8, instruction.length + 1))}ch`,
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => removeCoverInstruction(index)}
                          disabled={coverBusy}
                          aria-label={`不再参考：${instruction}`}
                          className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-rose-500/10 hover:text-rose-700 disabled:opacity-50"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
                {selectedCoverAsset
                  ? "“修改这张”会保留主要构图；“不满意，换 4 张”会重新构思。两者都会使用上面的全部文字要求。"
                  : "不选图也可以直接换一批；上面的文字会与已有要求一起用于下一轮。"}
              </p>
            </div>
          </div>

          <DialogFooter className="sticky bottom-0 border-t border-[var(--panel-border)] bg-[var(--background)]/95 px-5 py-4 backdrop-blur sm:px-6">
            {coverGenerationPresentation.message ? (
              <p
                role="status"
                className="mr-auto max-w-xs text-[11px] leading-4 text-muted-foreground"
              >
                {coverGenerationPresentation.message}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => setCoverStudioOpen(false)}
              disabled={coverBusy}
              className="h-9 rounded-md px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              先保留这些候选
            </button>
            <ActionButton
              onClick={() => void generateCover("fresh")}
              disabled={coverBusy}
              primary={!selectedCoverAsset && !coverAsset}
            >
              {coverGenerationPresentation.freshLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
              {coverRounds.length > 0 ? "不满意，换" : "生成"} 4 张 · ¥
              {coverEstimate.estimatedCny.toFixed(2)}
            </ActionButton>
            {canUseCoverFallback ? (
              <ActionButton
                onClick={() =>
                  void generateCover("fresh", undefined, "flux-schnell")
                }
                disabled={coverBusy}
              >
                <Sparkles className="h-4 w-4" />
                极速备用通道生成 1 张 · ¥
                {coverFallbackEstimate.estimatedCny.toFixed(2)}
              </ActionButton>
            ) : null}
            {selectedCoverAsset ? (
              <ActionButton
                onClick={() => void generateCover("revise")}
                disabled={coverBusy}
              >
                {coverGenerationPresentation.reviseLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {coverFeedback.trim() ? "按意见修改这张" : "基于这张再出 4 张"}·
                ¥{coverEstimate.estimatedCny.toFixed(2)}
              </ActionButton>
            ) : (
              <ActionButton onClick={() => {}} disabled>
                <MessageCircleMore className="h-4 w-4" />
                先选一张，再修改
              </ActionButton>
            )}
            {selectedCoverAsset ? (
              <ActionButton
                onClick={() => void adoptCoverCandidate(false)}
                disabled={coverBusy}
              >
                {adoptCoverMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                只采用这张
              </ActionButton>
            ) : null}
            {selectedCoverAsset ? (
              <ActionButton
                onClick={() => void adoptCoverCandidate(true)}
                disabled={coverBusy}
                primary
              >
                {adoptCoverMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                采用并进入视频
              </ActionButton>
            ) : coverAsset ? (
              <ActionButton
                onClick={() => {
                  setCoverStudioOpen(false);
                  void continueToVideo();
                }}
                disabled={coverBusy}
                primary
              >
                使用当前封面进入视频
                <ArrowRight className="h-4 w-4" />
              </ActionButton>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.section>
  );
}
