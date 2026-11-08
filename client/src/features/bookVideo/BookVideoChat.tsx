import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { confirmBookVideo } from "./confirmBookVideo";
import { createPortal } from "react-dom";
import { useBookVideoWorkspace } from "./BookVideoWorkspace";
import { BookVideoStartButton } from "./BookVideoStartButton";
import {
  clearReviewDraft,
  readReviewDraft,
  rememberReviewDraft,
} from "./bookVideoReviewDraft";
import {
  prepareBookForVideo,
  prepareMountedBook,
  refreshPreparedBook,
} from "./bookPreparation";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BOOK_VIDEO_QUESTION,
  confirmedBookVideoVersions,
  type BookVideoRecord,
} from "@shared/bookVideoCreation";
import { useBookVideoSession, type BookVideoSession } from "./bookVideoSession";
import { isPersistedStoryId } from "@shared/persistedStoryId";
export type BookVideoChatHandle = { submit(text: string): Promise<boolean> };
const button = "rounded-md border px-2 py-1 text-xs disabled:opacity-40";
const labels = {
  purpose: "用途",
  audience: "给谁看",
  tone: "表达风格",
  duration: "时长建议",
  narration: "台词与旁白",
  music: "音乐与音效",
  reuse: "素材复用",
  changes: "本轮调整",
} as const;
export function BookVideoChat({
  storyId,
  accountId,
  epoch,
  session,
  handle,
  onAdopt,
  onProgressChange,
}: {
  storyId: number;
  accountId: number | null;
  epoch: number;
  session: BookVideoSession | null;
  handle: MutableRefObject<BookVideoChatHandle | null>;
  onAdopt: () => Promise<void>;
  onProgressChange?: (message: string) => void;
}) {
  const _ui = useDesktopUiText();
  const utils = trpc.useUtils();
  const workspace = useBookVideoWorkspace();
  const query = trpc.bookVideo.list.useQuery(
    { storyId },
    {
      enabled: isPersistedStoryId(storyId),
      refetchOnWindowFocus: true,
      refetchInterval: q =>
        q.state.data?.records.some(r => r.status === "planning") ? 3000 : false,
    }
  );
  const propose = trpc.bookVideo.propose.useMutation();
  const organize = trpc.bookVideo.prepareManuscript.useMutation();
  const [organizeFirst, setOrganizeFirst] = useState(true);
  const [manuscriptNotice, setManuscriptNotice] = useState("");
  const generate = trpc.bookVideo.generate.useMutation();
  const adopt = trpc.bookVideo.adopt.useMutation();
  const edit = trpc.bookVideo.edit.useMutation();
  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(
    () => readReviewDraft(storyId, accountId)?.recordId ?? null
  );
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<BookVideoRecord["preview"]>(
    () => readReviewDraft(storyId, accountId)?.preview
  );
  const draftRevision = useRef<number | null>(
    readReviewDraft(storyId, accountId)?.revision ?? null
  );
  const token = useRef<{ text: string; id: string; parentId?: string } | null>(
    null
  );
  const lock = useRef(false);
  const [running, setRunning] = useState(false);
  const busy =
    running ||
    organize.isPending ||
    propose.isPending ||
    generate.isPending ||
    adopt.isPending ||
    edit.isPending;
  const progress = !busy
    ? ""
    : organize.isPending
      ? "正在整理分镜稿，保留原文与素材…"
      : propose.isPending
        ? _ui("正在整理视频方向…")
        : generate.isPending
          ? _ui("正在编排画面、台词与音乐…")
          : adopt.isPending
            ? _ui("正在采用视频素材表…")
            : edit.isPending
              ? _ui("正在保存方案参数…")
              : _ui("正在准备视频表格…");
  useEffect(() => {
    onProgressChange?.(progress);
  }, [onProgressChange, progress]);
  useEffect(() => () => onProgressChange?.(""), [onProgressChange]);
  const records = query.data?.records ?? [];
  const current = records.find(r => r.id === selected);
  const detail =
    records.find(r => r.id === opened) ??
    (workspace ? records.at(-1) : undefined);
  const confirmedVersions = confirmedBookVideoVersions(records);
  const versionLabel = (r: BookVideoRecord) =>
    confirmedVersions.find(item => item.record.id === r.id)?.version;
  const nextRecord = current ?? records.at(-1);
  async function confirmAndOpen(record: BookVideoRecord, reviewed = false) {
    await run(async () => {
      await confirmBookVideo(
        record,
        {
          prepare: async () => {
            const scope = storySpineStore.getState();
            if (
              scope.activeStoryId !== storyId ||
              scope.accountId !== accountId
            )
              throw new Error("已切换故事，请回到原故事继续。");
            if (record.bookSource)
              await prepareBookForVideo(storyId, accountId);
          },
          generate: () =>
            generate.mutateAsync({
              storyId,
              id: record.id,
              confirmBrief: true,
            }),
          adopt: () =>
            adopt.mutateAsync({
              storyId,
              id: record.id,
              reviewedRevision: record.revision,
            }),
          review: async ready => {
            await refresh();
            openReview(ready);
          },
          openTimeline: async () => {
            void refresh().catch(error => {
              console.warn("Video history refresh failed", error);
            });
            // Media reloads independently; a slow material index must not block navigation.
            void utils.storyAgent.storyMaterialState
              .invalidate({ storyId })
              .catch(error => {
                console.warn("Video media refresh failed", error);
              });
            const scope = storySpineStore.getState();
            if (
              scope.activeStoryId !== storyId ||
              scope.accountId !== accountId
            )
              return;
            await onAdopt();
            if (storySpineStore.getState().activeStoryId !== storyId) return;
            setOpened(null);
            workspace?.showEditing();
            useBookVideoSession.getState().setSession(null);
            window.dispatchEvent(
              new CustomEvent("dt:creation-flow-focus", {
                detail: { storyId, target: "editing" },
              })
            );
          },
        },
        reviewed ? record.revision : undefined
      );
    });
  }
  function nextStep(
    record: BookVideoRecord,
    reviewed = false,
    compact = false
  ) {
    if (record.status === "planning")
      return (
        <p role="status">{_ui("正在整理方案，完成后即可确认进入视频表格。")}</p>
      );
    if (!record.brief)
      return (
        <div className="space-y-2">
          <p>{record.error || _ui("请先补充视频想法。")}</p>
          <button
            className={button}
            disabled={busy}
            onClick={() => resume(record)}
          >
            {_ui("继续确认制作条件")}
          </button>
        </div>
      );
    return (
      <div className="space-y-2">
        {!compact && record.brief.question && record.status !== "adopted" && (
          <p className="text-muted-foreground">
            {_ui("可以直接确认以上建议；想调整的话，在聊天里补充即可。")}
          </p>
        )}
        <button
          className="rounded-md bg-[var(--nayin-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          disabled={busy || Boolean(draft)}
          onClick={() => void confirmAndOpen(record, reviewed)}
        >
          {busy
            ? _ui("正在准备视频表格…")
            : record.status === "adopted"
              ? _ui("进入视频表格")
              : record.preview
                ? reviewed
                  ? _ui("确认人物、台词和背景音，进入视频")
                  : _ui("查看并确认分镜")
                : _ui("确认方向，整理分镜")}
        </button>
        {!compact && (
          <p className="text-muted-foreground">
            {record.status === "adopted"
              ? _ui("视频 V{0} 已保留。", [versionLabel(record)])
              : _ui(
                  "先核对每个镜头的人物、台词/字幕与背景音，再确认进入视频。"
                )}{" "}
            {_ui("在表格里生成图片、制作视频；媒体费用会另行确认。")}
          </p>
        )}
      </div>
    );
  }
  useEffect(() => {
    setSelected(null);
    const savedDraft = readReviewDraft(storyId, accountId);
    setOpened(savedDraft?.recordId ?? null);
    setDraft(savedDraft?.preview);
    draftRevision.current = savedDraft?.revision ?? null;
    setError("");
    token.current = null;
    setManuscriptNotice("");
    setOrganizeFirst(true);
  }, [storyId, accountId, epoch]);
  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (!draft) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [draft]);
  const refresh = () => utils.bookVideo.list.invalidate({ storyId });
  async function run(task: () => Promise<void>) {
    if (lock.current) return false;
    lock.current = true;
    setRunning(true);
    setError("");
    try {
      await task();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成，已有内容保留");
      return false;
    } finally {
      lock.current = false;
      setRunning(false);
    }
  }
  useEffect(() => {
    handle.current = {
      async submit(text) {
        if (!session) return false;
        if (lock.current) return false;
        if (draft) {
          setError("请先保存或取消当前分镜稿的修改，再继续讨论新方案。");
          workspace?.openReview();
          return false;
        }
        const request =
          !selected && session.preferredDuration
            ? `此前选择的参考时长：${session.preferredDuration}（若本轮描述修改时长，以本轮为准）。\n${text}`
            : text;
        return await run(async () => {
          const assertScope = () => {
            const scope = storySpineStore.getState();
            if (
              scope.activeStoryId !== storyId ||
              scope.accountId !== accountId
            )
              throw new Error("已切换故事，请回到原故事继续。");
          };
          assertScope();
          await prepareMountedBook(storyId, accountId);
          assertScope();
          if (organizeFirst) {
            const result = await organize.mutateAsync({ storyId, request });
            const scope = storySpineStore.getState();
            if (
              scope.activeStoryId !== storyId ||
              scope.accountId !== accountId
            )
              return;
            await refreshPreparedBook(storyId, accountId, result.chapters);
            setManuscriptNotice(
              !result.shotCount
                ? ""
                : result.changed
                  ? `已整理为 ${result.shotCount} 镜的分镜稿。原文、图片和音频完整保留，原稿可从“版本”恢复；可在书页调整后继续讨论。`
                  : "已沿用现有分镜稿，原文与素材保持原样。"
            );
          }
          assertScope();
          const parentId = selected ?? undefined;
          if (
            !token.current ||
            token.current.text !== request ||
            token.current.parentId !== parentId
          )
            token.current = {
              text: request,
              id: crypto.randomUUID(),
              parentId,
            };
          const r = await propose.mutateAsync({
            storyId,
            versionId: session.versionId,
            layout: session.layout,
            request,
            ...token.current,
          });
          await refresh();
          assertScope();
          setSelected(r.id);
          setOpened(r.id);
        });
      },
    };
    return () => {
      handle.current = null;
    };
  }, [session, selected, storyId, organizeFirst, accountId, draft]);
  function openReview(r: BookVideoRecord) {
    if (draft && detail?.id !== r.id) {
      setError("请先保存当前分镜稿的修改，再切换方案。");
      workspace?.openReview();
      return;
    }
    setOpened(r.id);
    workspace?.openReview();
  }
  function updateDraft(
    shotId: string,
    field:
      | "speaker"
      | "voiceText"
      | "action"
      | "videoRequirement"
      | "soundRequirement"
      | "imageRequirement",
    value: string
  ) {
    if (!detail?.preview || detail.status !== "ready") return;
    setOpened(detail.id);
    if (!draft) draftRevision.current = detail.revision;
    const preview = {
      ...(draft ?? detail.preview),
      shots: (draft ?? detail.preview).shots.map(shot =>
        shot.draftShotId === shotId ? { ...shot, [field]: value } : shot
      ),
    };
    rememberReviewDraft(storyId, accountId, {
      recordId: detail.id,
      revision: draftRevision.current!,
      preview,
    });
    setDraft(preview);
  }
  function resume(r: BookVideoRecord) {
    if (draft) return;
    setSelected(r.id);
    if (!workspace) setOpened(null);
    workspace?.discuss();
    setDraft(undefined);
    useBookVideoSession.getState().setSession({
      storyId,
      accountId,
      epoch,
      versionId: r.versionId,
      layout: r.layout,
      onAdopt,
    });
  }
  const reviewContent = detail ? (
    <div className={workspace ? "flex h-full min-h-0 flex-col" : "space-y-4"}>
      <div className="shrink-0 space-y-2 border-b border-border px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="sr-only">{_ui("分镜稿")}</h2>
            <span className="text-muted-foreground">
              {detail.status === "adopted"
                ? _ui("已确认方案 · 当前剪辑以「剪辑与预览」为准")
                : _ui("待确认 · 尚未采用到视频")}
            </span>
            {detail.preview && (
              <span className="text-muted-foreground">
                {_ui("{0} 镜 · 建议 {1} 秒", [
                  detail.preview.shots.length,
                  detail.preview.shots.reduce(
                    (sum, shot) => sum + (shot.durationSec ?? 0),
                    0
                  ),
                ])}
              </span>
            )}
          </div>
          <select
            aria-label={_ui("分镜方案版本")}
            value={detail.id}
            disabled={busy || Boolean(draft)}
            onChange={event => {
              const record = records.find(
                item => item.id === event.target.value
              );
              if (record) openReview(record);
            }}
            className="max-w-full rounded border bg-transparent px-2 py-1"
          >
            {[...records].reverse().map((record, index) => (
              <option key={record.id} value={record.id}>
                {record.status === "adopted"
                  ? `视频 V${versionLabel(record)} · 已确认`
                  : `方案 ${records.length - index} · ${record.status === "ready" ? "待确认" : record.status === "planning" ? "整理中" : "讨论中"}`}
              </option>
            ))}
          </select>
        </div>
        <details className="max-h-[28vh] overflow-auto" open={!detail.preview}>
          <summary className="cursor-pointer text-muted-foreground">
            {_ui("创作方向、参数与素材盘点")}
          </summary>
          <p className="my-3 text-xs text-muted-foreground">
            {detail.status === "ready"
              ? _ui(
                  "请逐镜核对：谁说什么、画面如何呈现、背景音乐和音效是什么。可以直接修改，保存后再确认。"
                )
              : _ui(
                  "这是已保留的视频方案。可查看人物、台词/字幕和背景音；调整请继续讨论新版本。"
                )}
          </p>
          {detail.layout.dialogueRanges !== undefined && (
            <p className="mb-2 text-xs text-muted-foreground">
              {_ui(
                "已按书中“台词/字幕”标记带入原文，其他文字用于画面和上下文；你仍可在这里调整。"
              )}
            </p>
          )}
          <p className="text-sm whitespace-pre-wrap">
            {_ui("本轮要求：")}
            {detail.request}
          </p>
          <div>
            <dl className="grid gap-2 sm:grid-cols-2 mt-2">
              {detail.brief &&
                Object.entries(labels).map(([key, label]) => (
                  <div key={key}>
                    <dt className="font-medium">{_ui(label)}</dt>
                    <dd className="text-muted-foreground whitespace-pre-wrap">
                      {detail.brief![key as keyof typeof labels]}
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
          {detail.bookSource && detail.musicAssets !== undefined && (
            <p className="text-sm text-muted-foreground" role="status">
              {_ui("书内可用素材：")}
              {detail.layout.illustrations.length} {_ui("张图片、")}
              {detail.musicAssets?.length ?? 0}{" "}
              {_ui("段音乐。图片优先沿用，复用无需重新生成。")}
              {Boolean(detail.musicAssets?.length) &&
                (detail.brief?.useBookMusic === false
                  ? _ui("本轮按讨论结果不自动加入书内音乐。")
                  : _ui(
                      "配乐优先使用「{0}」，按书内顺序衔接、裁到成片长度；已编辑的配乐保留。",
                      [detail.musicAssets!.map(a => a.title).join("、")]
                    ))}
            </p>
          )}
          {!detail.preview && detail.bookSource && (
            <div className="flex gap-3 flex-wrap">
              {detail.layout.illustrations.map(
                ({ assetId }) =>
                  query.data?.images[assetId] && (
                    <div key={assetId}>
                      <img
                        className="h-20 object-contain"
                        src={query.data.images[assetId]}
                        alt="书内原图"
                      />
                      <span className="text-xs text-muted-foreground">
                        书内原图
                      </span>
                    </div>
                  )
              )}
              {[
                ...new Set(
                  Object.values(
                    query.data?.continuity?.[detail.id]?.byShot ?? {}
                  ).flat()
                ),
              ].map(id => (
                <div key={`old-${id}`}>
                  <img
                    className="h-20 object-contain"
                    src={query.data?.images[id]}
                    alt="沿用旧版画面"
                  />
                  <span className="text-xs text-muted-foreground">
                    沿用旧版画面
                  </span>
                </div>
              ))}
            </div>
          )}
          {Boolean(detail.missingMusic) && (
            <p role="status" className="text-amber-700 text-sm">
              {_ui("有")} {detail.missingMusic}{" "}
              {_ui("段书内音乐尚不可用，本轮不自动生成替代音乐。")}
            </p>
          )}
          {Boolean(detail.missingImages) && (
            <p role="status" className="text-amber-700 text-sm">
              {_ui("有")} {detail.missingImages}{" "}
              {_ui(
                "张书内图片尚未匹配到可用素材，请先重新上传到仓库；本方案未把它们算作已复用。"
              )}
            </p>
          )}
          {Boolean(
            query.data?.continuity?.[detail.id]?.unmatchedImageIds.length
          ) && (
            <div className="text-sm text-amber-700">
              <p>
                以下旧版画面仍保留在仓库，尚不能确定对应的新镜头，可先在书中放入对应镜头再重新规划。
              </p>
              <div className="flex gap-2 flex-wrap">
                {query.data?.continuity?.[detail.id].unmatchedImageIds.map(
                  id => (
                    <img
                      key={id}
                      className="h-20 object-contain"
                      src={query.data?.images[id]}
                      alt="旧版待归属画面"
                    />
                  )
                )}
              </div>
            </div>
          )}
        </details>
      </div>
      {detail.preview && (
        <div
          className="min-h-0 flex-1 overflow-auto px-4 pb-4"
          tabIndex={0}
          aria-label={_ui("逐镜分镜稿")}
        >
          <table className="w-full min-w-[1000px] table-fixed border-separate border-spacing-0 text-xs leading-relaxed">
            <colgroup>
              <col className="w-[15%]" />
              <col className="w-[12%]" />
              <col className="w-[18%]" />
              <col className="w-[18%]" />
              <col className="w-[19%]" />
              <col className="w-[18%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-background">
              <tr>
                {[
                  "画面与素材",
                  "说话人／旁白",
                  "台词／字幕",
                  "画面设计",
                  "动作与镜头",
                  "背景音乐／环境声／音效",
                ].map(h => (
                  <th
                    key={h}
                    scope="col"
                    className="border-b border-r border-border px-3 py-2 text-left text-xs font-medium"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(draft ?? detail.preview).shots.map((shot, index) => (
                <tr key={shot.draftShotId}>
                  <td className="border-b border-r border-border p-3 align-top">
                    <strong>
                      {index + 1}. {shot.subject}
                    </strong>
                    <p>
                      {shot.durationSec
                        ? _ui("建议 {0} 秒", [shot.durationSec])
                        : _ui("时长待按节奏调整")}
                    </p>
                    {shot.referenceImageId &&
                      query.data?.images[shot.referenceImageId] && (
                        <img
                          className="mt-2 max-h-20"
                          src={query.data.images[shot.referenceImageId]}
                          alt={_ui("镜头{0}复用图片", [index + 1])}
                        />
                      )}
                    {shot.referenceImageIds?.map(id =>
                      query.data?.images[id] ? (
                        <img
                          key={id}
                          className="mt-2 max-h-20"
                          src={query.data.images[id]}
                          alt={_ui("镜头{0}参考图片", [index + 1])}
                        />
                      ) : null
                    )}
                    {query.data?.continuity?.[detail.id]?.byShot[
                      shot.draftShotId
                    ]?.map(id => (
                      <div key={`previous-${id}`}>
                        <img
                          className="mt-2 max-h-20"
                          src={query.data?.images[id]}
                          alt={`镜头${index + 1}沿用旧版画面`}
                        />
                        <span className="text-muted-foreground">
                          沿用旧版画面
                        </span>
                      </div>
                    ))}
                    <p>
                      {shot.referenceImageIds?.length
                        ? _ui("书内参考图 · {0} 张", [
                            shot.referenceImageIds.length,
                          ])
                        : shot.referenceImageId
                          ? _ui("复用书内图片")
                          : shot.continuityImageId
                            ? _ui("参考已有图，需补画面")
                            : _ui("待补画面")}
                    </p>
                    {shot.supplementReason && <p>{shot.supplementReason}</p>}
                    <details>
                      <summary>{_ui("来源原文")}</summary>
                      {shot.scriptText}
                    </details>
                  </td>
                  {(
                    [
                      "speaker",
                      "voiceText",
                      "action",
                      "videoRequirement",
                      "soundRequirement",
                    ] as const
                  ).map(field => (
                    <td
                      key={field}
                      className="border-b border-r border-border p-2 align-top"
                    >
                      <textarea
                        aria-label={_ui("镜头{0}{1}", [
                          index + 1,
                          {
                            speaker: "说话人",
                            voiceText: "台词/字幕",
                            action: "画面描述",
                            videoRequirement: "动作与镜头",
                            soundRequirement: "背景音乐与音效",
                          }[field],
                        ])}
                        className="min-h-24 w-full resize-y rounded bg-transparent p-1 leading-relaxed [field-sizing:content] focus:outline-none focus:ring-1 focus:ring-[var(--nayin-accent)] disabled:text-foreground disabled:opacity-100"
                        value={
                          shot[field] ??
                          (field === "speaker"
                            ? shot.voiceText
                              ? detail.status === "adopted"
                                ? "旧方案未标注"
                                : "待确认"
                              : "无台词"
                            : "")
                        }
                        placeholder={
                          field === "soundRequirement"
                            ? "无（可填写音乐或音效要求）"
                            : undefined
                        }
                        disabled={busy || detail.status !== "ready"}
                        onChange={e =>
                          updateDraft(shot.draftShotId, field, e.target.value)
                        }
                      />
                      {field === "action" && (
                        <details>
                          <summary>{_ui("图片要求")}</summary>
                          <textarea
                            aria-label={_ui("镜头{0}图片要求", [index + 1])}
                            className="min-h-24 w-full bg-transparent"
                            value={shot.imageRequirement}
                            disabled={busy || detail.status !== "ready"}
                            onChange={e =>
                              updateDraft(
                                shot.draftShotId,
                                "imageRequirement",
                                e.target.value
                              )
                            }
                          />
                        </details>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="shrink-0 flex flex-wrap items-start gap-3 border-t border-border bg-background px-4 py-3">
        {draft && (
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await edit.mutateAsync({
                  storyId,
                  id: detail.id,
                  revision: draftRevision.current ?? detail.revision,
                  shots: draft.shots,
                });
                setDraft(undefined);
                draftRevision.current = null;
                clearReviewDraft(storyId, accountId);
                await refresh();
              })
            }
          >
            {_ui("保存方案修改")}
          </button>
        )}
        {draft && (
          <button
            className={button}
            disabled={busy}
            onClick={() => {
              setDraft(undefined);
              draftRevision.current = null;
              clearReviewDraft(storyId, accountId);
              setError("");
            }}
          >
            {_ui("取消修改")}
          </button>
        )}
        {detail.brief && nextStep(detail, Boolean(detail.preview), true)}
        <button
          className={button}
          disabled={busy || Boolean(draft)}
          onClick={() => resume(detail)}
        >
          {_ui("继续讨论")}
        </button>
      </div>
      {detail.edits?.length ? (
        <details className="max-h-40 shrink-0 overflow-auto px-4 pb-2 text-xs">
          <summary>
            {_ui("查看之前的参数（")}
            {detail.edits.length}
            {_ui("次修改）")}
          </summary>
          {detail.edits.map((p, i) => (
            <pre key={i} className="whitespace-pre-wrap text-xs">
              {p.shots
                .map(
                  (s, n) =>
                    `${n + 1}. ${s.subject}\n说话人：${s.speaker ?? "待确认"}\n台词/字幕：${s.voiceText}\n画面：${s.action}\n镜头：${s.videoRequirement}\n声音：${s.soundRequirement}`
                )
                .join("\n\n")}
            </pre>
          ))}
        </details>
      ) : null}
      {error && (
        <p role="alert" className="shrink-0 px-4 pb-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm">
      <h2 className="text-lg font-medium">{_ui("先把故事整理成分镜稿")}</h2>
      <p className="max-w-md text-muted-foreground">
        {query.isLoading
          ? _ui("正在读取视频方案…")
          : query.error
            ? _ui("视频方案读取失败，请重新打开。")
            : _ui("逐镜安排画面、人物、台词与声音，确认后再进入剪辑。")}
      </p>
      {!query.isLoading && !query.error && (
        <BookVideoStartButton storyId={storyId} />
      )}
    </div>
  );
  return (
    <section aria-label={_ui("视频创作对话")} className="space-y-2 text-xs">
      {records.map(r => (
        <article key={r.id} className="rounded-lg border bg-background/70 p-2">
          <div className="flex items-center justify-between">
            <strong>
              {r.status === "adopted"
                ? _ui("视频 V{0} · 已确认", [versionLabel(r)])
                : r.status === "ready"
                  ? _ui("视频素材表 · 待确认")
                  : r.status === "failed"
                    ? _ui("视频创作 · 未完成")
                    : _ui("视频创作方案")}
            </strong>
            <span className="text-[10px] text-muted-foreground">
              {new Date(r.createdAt).toLocaleString()}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap line-clamp-2">{r.request}</p>
          <p className="mt-1 text-muted-foreground line-clamp-2">
            {r.status === "planning"
              ? _ui("正在整理创作方向…")
              : r.status === "failed"
                ? r.error
                : r.brief?.purpose}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              className={button}
              disabled={busy || (Boolean(draft) && detail?.id !== r.id)}
              onClick={() => openReview(r)}
            >
              {_ui("打开方案与参数")}
            </button>
            <button
              className={button}
              disabled={busy || Boolean(draft)}
              onClick={() => resume(r)}
            >
              {_ui("继续讨论")}
            </button>
          </div>
        </article>
      ))}
      {session && (
        <div
          className="rounded-lg border p-2 space-y-2"
          aria-label={_ui("当前视频创作")}
        >
          <div className="flex items-center justify-between">
            <strong>{_ui("把书做成视频")}</strong>
            <button
              className={button}
              disabled={busy}
              onClick={() => useBookVideoSession.getState().setSession(null)}
            >
              {_ui("暂时收起")}
            </button>
          </div>
          {!current ? (
            <div className="space-y-2">
              <p>{BOOK_VIDEO_QUESTION}</p>
              {session.preferredDuration && (
                <p>
                  {_ui("参考时长：")}
                  {session.preferredDuration}
                  {_ui("，也可以在描述里调整。")}
                </p>
              )}
              <p className="text-muted-foreground">
                {_ui(
                  "我会结合书稿，帮你确认时长、氛围和用途。确认后再安排画面、台词与音乐。"
                )}
              </p>
            </div>
          ) : current.brief ? (
            <>
              <p>
                {current.briefConfirmedAt
                  ? _ui("本版制作条件已确认，可以继续讨论下一版本。")
                  : current.brief.question ||
                    _ui(
                      "这是根据你的想法整理的方向，可以继续在下方补充或修改。"
                    )}
              </p>
              <p className="font-medium">
                {current.briefConfirmedAt
                  ? _ui("已确认的制作条件")
                  : _ui("请确认这些制作条件")}
              </p>
              <dl className="space-y-1">
                {Object.entries(labels).map(([key, label]) => (
                  <div key={key}>
                    <dt className="inline text-muted-foreground">
                      {_ui(label)}：
                    </dt>
                    <dd className="inline">
                      {current.brief![key as keyof typeof labels]}
                    </dd>
                  </div>
                ))}
              </dl>
              {nextStep(current)}
            </>
          ) : (
            <p>{current.error || _ui("正在整理创作方向…")}</p>
          )}
          <label className="flex items-start gap-2 text-muted-foreground">
            <input
              type="checkbox"
              checked={organizeFirst}
              disabled={busy}
              onChange={event => setOrganizeFirst(event.target.checked)}
            />
            <span>
              先整理为可编辑的分镜稿，保留原稿版本。已有场／镜头则直接沿用。
            </span>
          </label>
          {!current && session.onAlbum && (
            <button className={button} onClick={session.onAlbum}>
              {_ui("制作静态画册")}
            </button>
          )}
          <p className="text-[10px] text-muted-foreground">
            {_ui("此步只整理文字方案，不购买图片、配音或视频。")}
          </p>
        </div>
      )}
      {!session && nextRecord && (
        <div
          className="rounded-lg border p-3 space-y-2"
          aria-label={_ui("视频制作下一步")}
        >
          <strong>{_ui("下一步：进入视频制作")}</strong>
          {nextRecord.brief && nextRecord.status !== "adopted" && (
            <dl className="space-y-1">
              {Object.entries(labels).map(([key, label]) => (
                <div key={key}>
                  <dt className="inline text-muted-foreground">
                    {_ui(label)}：
                  </dt>
                  <dd className="inline">
                    {nextRecord.brief![key as keyof typeof labels]}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {nextStep(nextRecord)}
        </div>
      )}
      {busy && !onProgressChange && (
        <p role="status" aria-live="polite" className="text-muted-foreground">
          {organize.isPending
            ? "正在整理分镜稿，保留原文与素材…"
            : propose.isPending
              ? _ui("正在根据书稿和你的要求整理视频方向…")
              : generate.isPending
                ? _ui("正在编排画面、台词与音乐，整理视频素材表…")
                : adopt.isPending
                  ? _ui("正在采用素材表，保留原书稿和已有素材…")
                  : edit.isPending
                    ? _ui("正在保存方案参数…")
                    : _ui("正在准备视频表格…")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {manuscriptNotice && (
        <p role="status" className="text-muted-foreground">
          {manuscriptNotice}
        </p>
      )}
      {workspace ? (
        workspace.host && createPortal(reviewContent, workspace.host)
      ) : (
        <Dialog
          open={Boolean(detail)}
          onOpenChange={open => {
            if (!open && !busy && !draft) {
              setOpened(null);
              setDraft(undefined);
            }
          }}
        >
          <DialogContent className="sm:max-w-[95vw] max-w-[95vw] max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{_ui("视频方案与素材表")}</DialogTitle>
            </DialogHeader>
            {reviewContent}
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
