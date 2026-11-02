import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
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
  type BookVideoRecord,
} from "@shared/bookVideoCreation";
import { useBookVideoSession, type BookVideoSession } from "./bookVideoSession";
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
}: {
  storyId: number;
  accountId: number | null;
  epoch: number;
  session: BookVideoSession | null;
  handle: MutableRefObject<BookVideoChatHandle | null>;
  onAdopt: () => Promise<void>;
}) {
  const _ui = useDesktopUiText();
  const utils = trpc.useUtils();
  const query = trpc.bookVideo.list.useQuery(
    { storyId },
    {
      refetchOnWindowFocus: true,
      refetchInterval: q =>
        q.state.data?.records.some(r => r.status === "planning") ? 3000 : false,
    }
  );
  const propose = trpc.bookVideo.propose.useMutation();
  const generate = trpc.bookVideo.generate.useMutation();
  const adopt = trpc.bookVideo.adopt.useMutation();
  const edit = trpc.bookVideo.edit.useMutation();
  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<BookVideoRecord["preview"]>();
  const token = useRef<{ text: string; id: string; parentId?: string } | null>(
    null
  );
  const lock = useRef(false);
  const busy =
    propose.isPending ||
    generate.isPending ||
    adopt.isPending ||
    edit.isPending;
  const records = query.data?.records ?? [];
  const current = records.find(r => r.id === selected);
  const detail = records.find(r => r.id === opened);
  useEffect(() => {
    setSelected(null);
    setOpened(null);
    setDraft(undefined);
    setError("");
    token.current = null;
  }, [storyId, accountId, epoch]);
  const refresh = () => utils.bookVideo.list.invalidate({ storyId });
  async function run(task: () => Promise<void>) {
    if (lock.current) return false;
    lock.current = true;
    setError("");
    try {
      await task();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成，已有内容保留");
      return false;
    } finally {
      lock.current = false;
    }
  }
  useEffect(() => {
    handle.current = {
      async submit(text) {
        if (!session) return false;
        if (lock.current) return false;
        return await run(async () => {
          const parentId = selected ?? undefined;
          if (
            !token.current ||
            token.current.text !== text ||
            token.current.parentId !== parentId
          )
            token.current = { text, id: crypto.randomUUID(), parentId };
          const r = await propose.mutateAsync({
            storyId,
            versionId: session.versionId,
            layout: session.layout,
            request: text,
            ...token.current,
          });
          await refresh();
          setSelected(r.id);
        });
      },
    };
    return () => {
      handle.current = null;
    };
  }, [session, selected, storyId]);
  function resume(r: BookVideoRecord) {
    setSelected(r.id);
    setOpened(null);
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
  return (
    <section aria-label={_ui("视频创作对话")} className="space-y-2 text-xs">
      {records.map(r => (
        <article key={r.id} className="rounded-lg border bg-background/70 p-2">
          <div className="flex items-center justify-between">
            <strong>{_ui("视频创作方案")}</strong>
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
              onClick={() => {
                setOpened(r.id);
                setDraft(undefined);
              }}
            >
              {_ui("打开方案与参数")}</button>
            <button
              className={button}
              disabled={busy}
              onClick={() => resume(r)}
            >
              {_ui("继续讨论")}</button>
          </div>
        </article>
      ))}
      {session && (
        <div
          className="rounded-lg border p-2 space-y-2"
          aria-label={_ui("当前视频创作")}
        >
          <div className="flex items-center justify-between">
            <strong>{_ui("制作视频")}</strong>
            <button
              className={button}
              disabled={busy}
              onClick={() => useBookVideoSession.getState().setSession(null)}
            >
              {_ui("结束讨论")}{" "}</button>
          </div>
          {!current ? (
            <p>{BOOK_VIDEO_QUESTION}</p>
          ) : current.brief ? (
            <>
              <p>
                {current.brief.question ||
                  _ui("这是根据你的想法整理的方向，可以继续在下方补充或修改。")}
              </p>
              <dl className="space-y-1">
                {Object.entries(labels).map(([key, label]) => (
                  <div key={key}>
                    <dt className="inline text-muted-foreground">{_ui(label)}：</dt>
                    <dd className="inline">
                      {current.brief![key as keyof typeof labels]}
                    </dd>
                  </div>
                ))}
              </dl>
              {!current.brief.question && !current.preview && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await generate.mutateAsync({
                        storyId,
                        id: current.id,
                      });
                      await refresh();
                      if (r.preview) setOpened(r.id);
                      else
                        setError(
                          "方案正在整理，稍后再次查询同一方案即可，不会生成图片或视频。"
                        );
                    })
                  }
                >
                  {busy ? _ui("正在整理…") : _ui("确认方向，整理素材表")}
                </button>
              )}
              {current.preview && (
                <button
                  className={button}
                  onClick={() => setOpened(current.id)}
                >
                  {_ui("查看素材表")}{" "}</button>
              )}
            </>
          ) : (
            <p>{current.error || _ui("正在整理创作方向…")}</p>
          )}
          {!current && session.onAlbum && (
            <button className={button} onClick={session.onAlbum}>
              {_ui("制作静态画册")}</button>
          )}
          <p className="text-[10px] text-muted-foreground">
            {_ui("此步只整理文字方案，不购买图片、配音或视频。")}</p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
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
          {detail && (
            <>
              <p className="text-sm whitespace-pre-wrap">
                {_ui("本轮要求：")}{detail.request}
              </p>
              <details>
                <summary className="cursor-pointer text-sm">{_ui("创作方向与参数")}</summary>
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
              </details>
              {Boolean(detail.missingImages) && <p role="status" className="text-amber-700 text-sm">{_ui("有")}{" "}{detail.missingImages} {_ui("张书内图片尚未匹配到可用素材，请先重新上传到仓库；本方案未把它们算作已复用。")}</p>}
              {detail.preview && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[850px] text-xs">
                    <thead>
                      <tr>
                        {[
                          "画面与素材",
                          "台词／旁白",
                          "画面设计",
                          "动作与镜头",
                          "音乐／音效",
                        ].map(h => (
                          <th key={h} className="border p-2 text-left">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(draft ?? detail.preview).shots.map((shot, index) => (
                        <tr key={shot.draftShotId}>
                          <td className="border p-2 align-top w-36">
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
                                  className="mt-2 max-h-24"
                                  src={query.data.images[shot.referenceImageId]}
                                  alt={_ui("镜头{0}复用图片", [index + 1])}
                                />
                              )}
                            <p>
                              {shot.referenceImageId
                                ? _ui("复用书内图片")
                                : shot.continuityImageId
                                  ? _ui("参考已有图，需补画面")
                                  : _ui("待补画面")}
                            </p>
                            {shot.supplementReason && (
                              <p>{shot.supplementReason}</p>
                            )}
                            <details>
                              <summary>{_ui("来源原文")}</summary>
                              {shot.scriptText}
                            </details>
                          </td>
                          {(
                            [
                              "voiceText",
                              "action",
                              "videoRequirement",
                              "soundRequirement",
                            ] as const
                          ).map(field => (
                            <td key={field} className="border p-1 align-top">
                              <textarea
                                aria-label={_ui("镜头{0}{1}", [index + 1, field])}
                                className="min-h-28 w-full resize-y bg-transparent p-1"
                                value={shot[field]}
                                disabled={busy || detail.status !== "ready"}
                                onChange={e => {
                                  const value = e.target.value;
                                  setDraft(prev => ({
                                    ...(prev ?? detail.preview!),
                                    shots: (prev ?? detail.preview!).shots.map(
                                      s =>
                                        s.draftShotId === shot.draftShotId
                                          ? { ...s, [field]: value }
                                          : s
                                    ),
                                  }));
                                }}
                              />
                              {field === "action" && (
                                <details>
                                  <summary>{_ui("图片要求")}</summary>
                                  <textarea
                                    aria-label={_ui("镜头{0}图片要求", [index + 1])}
                                    className="min-h-24 w-full bg-transparent"
                                    value={shot.imageRequirement}
                                    disabled={busy || detail.status !== "ready"}
                                    onChange={e => {
                                      const value = e.target.value;
                                      setDraft(prev => ({
                                        ...(prev ?? detail.preview!),
                                        shots: (
                                          prev ?? detail.preview!
                                        ).shots.map(s =>
                                          s.draftShotId === shot.draftShotId
                                            ? { ...s, imageRequirement: value }
                                            : s
                                        ),
                                      }));
                                    }}
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
              <div className="flex gap-2">
                {draft && (
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await edit.mutateAsync({
                          storyId,
                          id: detail.id,
                          revision: detail.revision,
                          shots: draft.shots,
                        });
                        setDraft(undefined);
                        await refresh();
                      })
                    }
                  >
                    {_ui("保存方案修改")}</button>
                )}
                {detail.status === "ready" && (
                  <button
                    className={button}
                    disabled={busy || Boolean(draft)}
                    onClick={() =>
                      void run(async () => {
                        await adopt.mutateAsync({ storyId, id: detail.id });
                        await refresh();
                        await (session?.onAdopt ?? onAdopt)();
                        setOpened(null);
                        useBookVideoSession.getState().setSession(null);
                      })
                    }
                  >
                    {_ui("采用到视频素材表")}{" "}</button>
                )}
                <button
                  className={button}
                  disabled={busy || Boolean(draft)}
                  onClick={() => resume(detail)}
                >
                  {_ui("继续讨论")}</button>
              </div>
              {detail.edits?.length ? (
                <details>
                  <summary>
                    {_ui("查看之前的参数（")}{detail.edits.length}{_ui("次修改）")}</summary>
                  {detail.edits.map((p, i) => (
                    <pre key={i} className="whitespace-pre-wrap text-xs">
                      {p.shots
                        .map(
                          (s, n) =>
                            `${n + 1}. ${s.subject}\n台词：${s.voiceText}\n画面：${s.action}\n镜头：${s.videoRequirement}\n声音：${s.soundRequirement}`
                        )
                        .join("\n\n")}
                    </pre>
                  ))}
                </details>
              ) : null}
              {error && (
                <p role="alert" className="text-red-600">
                  {error}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
