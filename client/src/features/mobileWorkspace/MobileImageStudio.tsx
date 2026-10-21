import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PublishingImagePack } from "@/features/publishingAlbum/PublishingImagePack";
import type { StudioCreateRequest } from "@/features/publishingDraft/StudioCreateMenu";
import {
  isRecoverablePublishingCoverGeneration,
  type PublishingDraftContent,
} from "@shared/publishingDraft";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const button =
  "min-h-11 rounded-full border border-border px-4 text-sm disabled:opacity-40";
export type MobileArtworkSource = {
  id: string;
  kind?: "memory";
  content: PublishingDraftContent;
};
export function MobileImageStudio({
  storyId,
  userId,
  source,
  onBack,
  createRequest,
}: {
  storyId: number;
  userId: number;
  source?: MobileArtworkSource;
  onBack(): void;
  createRequest?: StudioCreateRequest;
}) {
  const t = useUiText();

  const utils = trpc.useUtils();
  const read = trpc.publishingDraft.read.useQuery(
    { storyId },
    {
      retry: false,
      refetchInterval: query =>
        query.state.data?.publishing.coverGeneration?.status === "pending" ||
        query.state.data?.coverRounds.some(
          round => round.qualityCheckPendingUntil
        )
          ? 2000
          : false,
    }
  );
  const generate = trpc.publishingDraft.generateCover.useMutation({
    retry: false,
  });
  const adopt = trpc.textDrafts.adopt.useMutation({ retry: false });
  const revoke = trpc.artworkShare.revoke.useMutation({ retry: false });
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [confirmAdopt, setConfirmAdopt] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [message, setMessage] = useState("");
  const [shareEpoch, setShareEpoch] = useState(0);
  const data = read.data;
  const publishing = data?.publishing;
  const platform = publishing?.activePlatform ?? "xiaohongshu";
  const draft = publishing?.drafts[platform];
  const content = source?.content ?? draft?.content;
  const isMemory = source?.kind === "memory";
  const sourceMatches =
    !source ||
    Boolean(
      draft &&
        draft.content.title === source.content.title &&
        draft.content.body === source.content.body
    );
  const receipt = publishing?.coverGeneration;
  const recoverable =
    receipt?.status === "pending" ||
    isRecoverablePublishingCoverGeneration(receipt);
  const busy = generate.isPending || adopt.isPending;
  async function generateImages(
    instruction: string,
    kind?: "illustration" | "body-texture",
    coverId?: number,
    recover = false
  ) {
    if (isMemory || !data || !content || !sourceMatches || inFlight.current)
      return;
    // Normal buttons cannot silently turn a new purchase into recovery of another task.
    if (recoverable && !recover) {
      setError("请先恢复上次生成任务");
      return;
    }
    inFlight.current = true;
    setError("");
    try {
      const result = await generate.mutateAsync({
        storyId,
        platform,
        basePublishingRevision: data.publishing.revision,
        provider: "midjourney",
        operationToken: recover
          ? receipt?.operationToken
          : `cover-${crypto.randomUUID()}`,
        feedback: instruction || undefined,
        referenceAssetId: coverId,
        outputKind: kind,
        costConfirmation: recover
          ? undefined
          : { accepted: true, estimatedCny: data.coverEstimate.estimatedCny },
      });
      if (result.status === "confirmation_required")
        setError("费用预估发生变化，请重新查看并确认生成。");
      if (result.status === "error")
        setError("这次生成未完成，请查看任务状态；已受理的任务可以恢复。");
      await read.refetch();
      await utils.publishingDraft.readBody.invalidate({ storyId });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "生成未完成，请重新读取任务状态"
      );
      await read.refetch();
    } finally {
      inFlight.current = false;
      void utils.storyAgent.storyMaterialState.invalidate({ storyId });
      void utils.storyAgent.storyImages.invalidate({ storyId });
    }
  }
  async function useSource() {
    if (isMemory || !source || !data) return;
    setError("");
    try {
      const history = await utils.textDrafts.read.fetch({ storyId });
      await adopt.mutateAsync({
        storyId,
        versionId: source.id,
        expectedRevision: history.revision,
        expectedPublishingRevision: data.publishing.revision,
        content: source.content,
        feedback: "",
      });
      await Promise.all([
        read.refetch(),
        utils.publishingDraft.readBody.invalidate({ storyId }),
        utils.textDrafts.read.invalidate({ storyId }),
      ]);
      setConfirmAdopt(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "采用失败，原稿已保留");
    }
  }
  return (
    <section
      aria-label={t("手机图文制作")}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          aria-label={isMemory ? t("返回记忆") : t("返回文字稿")}
          className="grid size-11 place-items-center"
          disabled={busy}
          onClick={onBack}
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-chat-brand text-xl">{t("制作图文")}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {read.isLoading ? (
          <p role="status" className="p-5">
            {t("正在读取图片…")}
          </p>
        ) : read.isError ? (
          <p role="alert" className="p-5">
            {t("图片暂时没有读到。")}
            <button className={button} onClick={() => void read.refetch()}>
              {t("重试")}
            </button>
          </p>
        ) : !content?.body.trim() ? (
          <p className="p-5 text-sm">{t("先写好正文，再把它做成图片。")}</p>
        ) : data && publishing ? (
          <>
            {isMemory ? (
              <p className="px-5 pt-4 text-xs leading-6 text-muted-foreground">
                {t(
                  "把这段记忆做成图文，可选已有配图或纸张纹理。需要生成新配图时，请在文字稿阶段制作。"
                )}
              </p>
            ) : null}
            {!isMemory && !sourceMatches ? (
              <div className="space-y-2 px-5 pt-4 text-sm leading-6">
                <p>
                  {t(
                    "正在排版这份文字稿，可使用已有图片。生成新配图前，需要先将它采用为当前发布稿。"
                  )}
                </p>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => setConfirmAdopt(true)}
                >
                  {t("采用这份文字来配图")}
                </button>
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="px-5 pt-4 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {!isMemory && recoverable ? (
              <div className="px-5 pt-4 text-sm leading-6">
                <p>{t("上次生成尚未结束。恢复只接着读取同一任务。")}</p>
                <button
                  className={button}
                  disabled={busy || !sourceMatches}
                  onClick={() =>
                    void generateImages("", undefined, undefined, true)
                  }
                >
                  {t("恢复上次生成")}
                </button>
              </div>
            ) : null}
            <PublishingImagePack
              createRequest={createRequest}
              accountId={userId}
            sharePlatform={platform}
              key={`${storyId}:${source?.id ?? publishing.activeVersionId}:${platform}`}
              mobile
              contentKind={isMemory ? "memory" : "article"}
              shareEpoch={shareEpoch}
              scope={`${userId}:${storyId}:${source?.id ?? publishing.activeVersionId}:${platform}`}
              storyId={storyId}
              versionId={publishing.activeVersionId ?? "v1"}
              hasAlbum={Boolean(
                publishing.versions?.find(
                  item => item.versionId === publishing.activeVersionId
                )?.album
              )}
              title={content.title}
              body={content.body}
              adoptedCoverId={data.coverAsset?.id ?? null}
              assets={[
                ...(data.coverAsset
                  ? [
                      {
                        id: data.coverAsset.id,
                        imageUrl: data.coverAsset.imageUrl,
                        label: t("正式封面"),
                      },
                    ]
                  : []),
                ...data.coverRounds.flatMap((round, index) =>
                  round.candidates.map((asset, ordinal) => ({
                    id: asset.id,
                    imageUrl: asset.imageUrl,
                    label: `${round.outputKind === "illustration" ? t("插图") : round.outputKind === "body-texture" ? t("底图") : t("封面")} ${index + 1} · ${ordinal + 1}`,
                    kind: round.outputKind,
                    parentAssetId: round.parentAssetId,
                    warning: round.qualityFlaggedAssetIds?.includes(asset.id)
                      ? t("疑似含字")
                      : round.qualityCheckPendingUntil
                        ? t("质检中")
                        : round.qualityCheckUnavailable
                          ? t("质检未完成")
                          : undefined,
                  }))
                ),
              ]}
              coverBusy={
                isMemory || busy || Boolean(recoverable) || !sourceMatches
              }
              generationError={isMemory ? undefined : receipt?.error}
              generationStartedAt={
                generate.isPending ? generate.submittedAt : undefined
              }
              illustrationCost={data.coverEstimate.estimatedCny}
              onGenerateCover={
                isMemory
                  ? undefined
                  : instruction => generateImages(instruction)
              }
              onGenerateIllustration={
                isMemory
                  ? undefined
                  : (id, instruction) =>
                      generateImages(instruction, "illustration", id)
              }
              onGenerateTexture={
                isMemory
                  ? undefined
                  : (id, instruction) =>
                      generateImages(instruction, "body-texture", id)
              }
            />
            <details className="mx-5 mt-6 border-t border-border pt-4 text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                {t("管理作品链接")}
              </summary>
              <p className="my-3 text-xs leading-6">
                {t(
                  "停止后，这个故事之前创建的所有图文作品链接将无法再打开。别人已保存的图片不受影响。"
                )}
              </p>
              <button className={button} onClick={() => setConfirmRevoke(true)}>
                {t("停止这个故事的作品链接")}
              </button>
              {message ? (
                <p role="status" className="mt-2">
                  {message}
                </p>
              ) : null}
            </details>
          </>
        ) : null}
      </div>
      <Dialog open={confirmAdopt} onOpenChange={setConfirmAdopt}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("采用这份文字来配图？")}</DialogTitle>
            <DialogDescription>
              {t(
                "这会更新电脑和手机共用的当前发布稿。原文字版本保留，采用本身不会购买图片生成。"
              )}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <button
            className={button}
            disabled={busy}
            onClick={() => void useSource()}
          >
            {busy ? t("正在采用…") : t("确认采用")}
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("停止这些作品链接？")}</DialogTitle>
            <DialogDescription>
              {t("此故事所有旧图文链接都会失效；之后可以重新创建新链接。")}
            </DialogDescription>
          </DialogHeader>
          <button
            className={button}
            disabled={revoke.isPending}
            onClick={() => {
              void revoke
                .mutateAsync({ storyId })
                .then(() => {
                  setMessage(t("旧作品链接已停止"));
                  setShareEpoch(value => value + 1);
                  setConfirmRevoke(false);
                })
                .catch(cause => {
                  setError(cause.message);
                  setConfirmRevoke(false);
                });
            }}
          >
            {t("确认停止")}
          </button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
