import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PublishingImagePack } from "@/features/publishingAlbum/PublishingImagePack";
import type { StudioCreateRequest } from "@/features/publishingDraft/StudioCreateMenu";
import {
  computePublishingDraftContentHash,
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
  embedded = false,
}: {
  storyId: number;
  userId: number;
  source?: MobileArtworkSource;
  onBack(): void;
  createRequest?: StudioCreateRequest;
  embedded?: boolean;
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
  const [confirmAdopt, setConfirmAdopt] = useState<{
    versionId: string;
    content: PublishingDraftContent;
    historyRevision: number;
    publishingRevision: number;
  } | null>(null);
  const [nextCreateRequest, setNextCreateRequest] =
    useState<StudioCreateRequest>();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [message, setMessage] = useState("");
  const [shareEpoch, setShareEpoch] = useState(0);
  const data = read.data;
  const publishing = data?.publishing;
  const platform = publishing?.activePlatform ?? "xiaohongshu";
  const draft = publishing?.drafts[platform];
  const content = source?.content ?? draft?.content;
  const isMemory = source?.kind === "memory";
  const history = trpc.textDrafts.read.useQuery(
    { storyId },
    {
      enabled: !isMemory && (!draft?.content.body.trim() || Boolean(source)),
      retry: false,
    }
  );
  const versions = (history.data?.versions ?? []).filter(
    version => version.status === "ready" && version.generated?.body.trim()
  );
  const suggested = source
    ? versions.find(version => version.id === source.id)
    : [...versions].reverse().find(version => !version.adoption);
  const sourceMatches =
    !source ||
    Boolean(
      draft &&
        suggested?.adoption &&
        suggested.request.platform === platform &&
        draft.content.title === source.content.title &&
        draft.content.body === source.content.body &&
        JSON.stringify(draft.content.tags) ===
          JSON.stringify(source.content.tags)
    );
  const receipt = publishing?.coverGeneration;
  const recoverable =
    receipt?.status === "pending" ||
    isRecoverablePublishingCoverGeneration(receipt);
  const busy = generate.isPending || adopt.isPending;
  const needsTextConfirmation =
    !isMemory && (!content?.body.trim() || !sourceMatches);
  function reviewText() {
    setError("");
    if (!suggested || !history.data || !publishing) return;
    setConfirmAdopt({
      versionId: suggested.id,
      content:
        source?.content ?? suggested.adoption?.content ?? suggested.generated!,
      historyRevision: history.data.revision,
      publishingRevision: publishing.revision,
    });
  }
  const reviewedRequest = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      createRequest?.kind !== "image" ||
      !needsTextConfirmation ||
      !suggested ||
      reviewedRequest.current === createRequest.id
    )
      return;
    reviewedRequest.current = createRequest.id;
    reviewText();
  }, [
    createRequest,
    needsTextConfirmation,
    suggested,
    history.data,
    publishing,
  ]);
  async function generateImages(
    instruction: string,
    kind?: "illustration" | "body-texture",
    coverId?: number,
    recover = false
  ) {
    if (
      isMemory ||
      !data ||
      !content?.body.trim() ||
      !sourceMatches ||
      inFlight.current
    )
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
    if (isMemory || !confirmAdopt || !data || inFlight.current) return;
    inFlight.current = true;
    setError("");
    try {
      const result = await adopt.mutateAsync({
        storyId,
        versionId: confirmAdopt.versionId,
        expectedRevision: confirmAdopt.historyRevision,
        expectedPublishingRevision: confirmAdopt.publishingRevision,
        content: confirmAdopt.content,
        feedback: "",
      });
      const current =
        result.publishing.drafts[result.publishing.activePlatform]?.content;
      if (
        !current ||
        computePublishingDraftContentHash(current) !==
          computePublishingDraftContentHash(confirmAdopt.content)
      )
        throw new Error(
          "这份历史文字已采用过，当前正文已变化。请返回文字页核对当前版本。"
        );
      await Promise.all([
        read.refetch(),
        utils.publishingDraft.readBody.invalidate({ storyId }),
        utils.textDrafts.read.invalidate({ storyId }),
      ]);
      setConfirmAdopt(null);
      setNextCreateRequest({
        id: crypto.randomUUID(),
        storyId,
        kind: "image",
        instruction: createRequest?.instruction ?? "",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "采用失败，原稿已保留");
      // Keep the reviewed snapshot fixed. Returning to text must load the latest
      // state before the user decides how to handle a conflict.
      void read.refetch();
      void history.refetch();
      void utils.publishingDraft.readBody.invalidate({ storyId });
    } finally {
      inFlight.current = false;
    }
  }
  return (
    <section
      aria-label={t("手机图文制作")}
      data-stage-swipe="ignore"
      className="flex h-full min-h-0 flex-col"
    >
      {!embedded && (
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
      )}
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
        ) : data && publishing ? (
          <>
            {isMemory ? (
              <p className="px-5 pt-4 text-xs leading-6 text-muted-foreground">
                {t(
                  "把这段记忆做成图文，可选已有配图或纸张纹理。需要生成新配图时，请在文字稿阶段制作。"
                )}
              </p>
            ) : null}
            {needsTextConfirmation ? (
              <div className="space-y-2 px-5 pt-4 text-sm leading-6">
                <p>
                  {t(
                    suggested
                      ? "先确认配图用的文字，已有图片仍可上传和排版。"
                      : "还没有确认的文字。先去文字页准备一版，也可以先上传图片。"
                  )}
                </p>
                <button
                  className={`${button} bg-primary text-primary-foreground`}
                  disabled={busy || history.isLoading}
                  onClick={suggested ? reviewText : onBack}
                >
                  {t(
                    history.isLoading
                      ? "正在读取文字…"
                      : suggested
                        ? "查看并确认文字"
                        : "去文字页"
                  )}
                </button>
                {history.isError && (
                  <button
                    className={button}
                    onClick={() => void history.refetch()}
                  >
                    {t("重新读取文字版本")}
                  </button>
                )}
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
              createRequest={
                needsTextConfirmation
                  ? undefined
                  : (nextCreateRequest ?? createRequest)
              }
              onPrepareGeneration={
                needsTextConfirmation
                  ? suggested
                    ? reviewText
                    : onBack
                  : undefined
              }
              accountId={userId}
              sharePlatform={platform}
              key={`${storyId}:${source?.id ?? publishing.activeVersionId}:${platform}`}
              mobile
              initialMobileStep={isMemory ? "preview" : "images"}
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
              title={content?.title ?? ""}
              body={content?.body ?? ""}
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
                isMemory ||
                !content?.body.trim() ||
                busy ||
                Boolean(recoverable) ||
                !sourceMatches
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
      <Dialog
        open={Boolean(confirmAdopt)}
        onOpenChange={open => {
          if (!open && !busy) setConfirmAdopt(null);
        }}
      >
        <DialogContent className="flex max-h-[90dvh] flex-col">
          <DialogHeader>
            <DialogTitle>{t("确认配图用的文字")}</DialogTitle>
            <DialogDescription>
              {t("确认后进入配图设置。旧文字版本保留，图片费用会另行确认。")}
            </DialogDescription>
          </DialogHeader>
          {confirmAdopt && (
            <>
              {!source &&
                versions.filter(version => !version.adoption).length > 1 && (
                  <select
                    aria-label={t("配图文字版本")}
                    className={button}
                    value={confirmAdopt.versionId}
                    disabled={busy}
                    onChange={event => {
                      const version = versions.find(
                        item => item.id === event.target.value
                      );
                      if (version?.generated)
                        setConfirmAdopt({
                          ...confirmAdopt,
                          versionId: version.id,
                          content:
                            version.adoption?.content ?? version.generated,
                        });
                    }}
                  >
                    {versions
                      .filter(version => !version.adoption)
                      .map(version => (
                        <option key={version.id} value={version.id}>
                          {t("文字稿")}
                          {version.sequence}
                        </option>
                      ))}
                  </select>
                )}
              <article className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words py-3 font-serif leading-8">
                <h3 className="mb-3 text-lg">{confirmAdopt.content.title}</h3>
                <p>{confirmAdopt.content.body}</p>
              </article>
            </>
          )}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <button
            className={`${button} shrink-0 bg-primary text-primary-foreground`}
            disabled={busy}
            onClick={() => void useSource()}
          >
            {busy ? t("正在确认…") : t("确认这版，继续配图")}
          </button>
          <button
            className={button}
            disabled={busy}
            onClick={() => {
              setConfirmAdopt(null);
              onBack();
            }}
          >
            {t("返回文字修改")}
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
