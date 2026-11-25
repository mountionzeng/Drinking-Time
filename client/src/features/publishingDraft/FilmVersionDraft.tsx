import { useStoryboardScenes } from "../storyAgent/useStoryboardScenes";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc, type RouterInputs } from "@/lib/trpc";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import { useDesktopWritingSession } from "@/features/writingCompanion/desktopWritingSession";
import { prepareMountedBook } from "@/features/bookVideo/bookPreparation";
import { STUDIO_CREATE_EVENT, type StudioCreateRequest } from "./StudioCreateMenu";
import { saveStudioCreateHandoff } from "./studioCreateHandoff";
import type { ConversionDraft } from "@shared/bookWorkflow";
import { formatComputeQuote } from "@shared/computeMoney";
import { writingModuleTexts } from "@shared/bookWritingStyle";
import { readBookImage } from "@shared/bookImageBlock";
import { readBookAudio } from "@shared/bookAudioBlock";

const button = "rounded-md border px-3 py-2 text-sm disabled:opacity-40";
const isGenerating = (draft: ConversionDraft) =>
  draft.status === "generating" && Date.now() - draft.createdAt < 15 * 60 * 1000;
type FilmQuote = { input: RouterInputs["bookWorkflow"]["generateFilm"]; amount: number };
export function FilmVersionDraft({ storyId, request, blocked, onDone, target = "storyboard",
  chatTurnId, startOnOpen, approveRef,
}: {
  target?: "text" | "storyboard"; storyId: number; request: string; blocked: boolean; onDone(): void;
  chatTurnId?: string; startOnOpen?: boolean; approveRef?: RefObject<(() => void) | null>;
}) {
  const ui = useUiText();
  const utils = trpc.useUtils();
  const query = trpc.bookWorkflow.get.useQuery({ storyId }, {
    refetchInterval: q => q.state.data?.state.conversions.some(isGenerating) ? 3000 : false,
  });
  const getQuote = trpc.bookWorkflow.quoteFilm.useMutation({ retry: false });
  const generate = trpc.bookWorkflow.generateFilm.useMutation({ retry: false });
  const edit = trpc.bookWorkflow.edit.useMutation({ retry: false });
  const adopt = trpc.bookWorkflow.adopt.useMutation({ retry: false });
  const [draft, setDraft] = useState<ConversionDraft | null>(null);
  const [quote, setQuote] = useState<FilmQuote | null>(null);
  const [editing, setEditing] = useState<{ id: string; revision: number; values: string[][] } | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const lock = useRef(false);
  const opened = useRef(false);
  const pendingRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const origin = useRef(storySpineStore.getState());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function current() {
    const now = storySpineStore.getState(), start = origin.current;
    if (!mounted.current || now.activeStoryId !== storyId || now.accountId !== start.accountId || now.storyScopeEpoch !== start.storyScopeEpoch)
      throw new Error(ui("已切换故事，请回到原故事查看生成结果。"));
  }
  const conversions = query.data?.state.conversions ?? [];
  const id = chatTurnId ?? draft?.id;
  const saved = id ? conversions.find(d => d.id === id) : [...conversions].reverse().find(d =>
    d.target === target && (d.status === "review" || isGenerating(d) ||
      (d.status === "adopted" && d.adoptedId === query.data?.state.current[target])));
  const preview = draft && (!saved || draft.revision > saved.revision) ? draft : saved;
  const acceptedVersion = preview?.status === "adopted"
    ? query.data?.state.versions.find(version => version.id === preview.adoptedId) : undefined;
  const chapters = preview?.chapters ?? (chatTurnId && acceptedVersion
    ? preview?.revisedChapters?.map(ref => acceptedVersion.chapters[ref.index]) ?? acceptedVersion.chapters
    : undefined);
  const showScenes = useStoryboardScenes(storyId, chapters?.some(c => c.blocks.storyboardScenes));
  const busy = blocked || running || Boolean(preview && isGenerating(preview));
  const canReopen = !busy && target === "storyboard" && Boolean(acceptedVersion && acceptedVersion.id === query.data?.state.current.storyboard);
  const canApprove = preview?.status === "review" && Boolean(preview.chapters) && !busy &&
    (!request.trim() || request.trim() === preview.request.trim()) &&
    (!editing || (editing.id === preview.id && editing.revision === preview.revision));

  async function run(task: () => Promise<void>) {
    if (lock.current || blocked) return;
    lock.current = true; setRunning(true); setError("");
    try {
      current();
      await prepareMountedBook(storyId, origin.current.accountId);
      current();
      await task();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : ui("操作未完成，原稿已保留"));
    } finally {
      lock.current = false;
      if (mounted.current) setRunning(false);
    }
  }
  function prepareQuote() {
    return run(async () => {
      const scope = storySpineStore.getState();
      const at = chatTurnId ? scope.messages.findIndex(m => m.id === chatTurnId) : -1;
      if (chatTurnId && at < 0) throw new Error(ui("当前请求已变化，请重新查看。"));
      const history = at >= 0 ? scope.messages.slice(0, at + 1) : scope.messages;
      const conversation = history.filter(m => !m.interfaceAction && m.content.trim())
        .map(({ role, content }) => ({ role, content }));
      const writing = useDesktopWritingSession.getState().session;
      const chapterId = !chatTurnId && writing?.storyId === storyId && writing.accountId === scope.accountId && writing.epoch === scope.storyScopeEpoch
        ? Number(writing.getSnapshot().chapterId) || undefined : undefined;
      const input = { storyId, request, target, chapterId, conversation };
      const result = await getQuote.mutateAsync(input);
      current();
      const previous = pendingRequest.current;
      const id = chatTurnId ?? (previous?.fingerprint === result.fingerprint ? previous.id : crypto.randomUUID());
      pendingRequest.current = { id, fingerprint: result.fingerprint };
      setQuote({ input: { ...input, id, quoteFingerprint: result.fingerprint }, amount: result.estimatedCny });
    });
  }
  useEffect(() => {
    if (!startOnOpen || !query.data || blocked || preview || opened.current) return;
    opened.current = true;
    void prepareQuote();
  }, [startOnOpen, query.data, blocked, preview]);
  function submitQuote() {
    if (!quote) return;
    void run(async () => {
      const input = quote.input;
      setQuote(null);
      try {
        const next = await generate.mutateAsync(input);
        current(); setDraft(next);
      } finally {
        const latest = await query.refetch();
        const status = latest.data?.state.conversions.find(row => row.id === input.id)?.status;
        if (status && status !== "generating") pendingRequest.current = null;
      }
    });
  }
  async function saveEdits() {
    if (!editing || !preview) return preview;
    const next = await edit.mutateAsync({ storyId, id: editing.id, revision: editing.revision, texts: editing.values });
    current(); setDraft(next); setEditing(null);
    return next;
  }
  function continueFilm() {
    if (!preview || !(canApprove || canReopen)) return;
    void run(async () => {
      const reviewed = await saveEdits();
      if (!reviewed) return;
      const version = acceptedVersion ?? await adopt.mutateAsync({ storyId, id: reviewed.id, revision: reviewed.revision });
      current();
      await utils.chapters.list.invalidate({ storyId });
      const chapters = await utils.chapters.list.fetch({ storyId, kind: target });
      await Promise.all(chapters.map(chapter => utils.chapters.get.invalidate({ chapterId: chapter.id })));
      await query.refetch();
      current();
      const chapterId = reviewed.revisedChapters?.[0]?.id ??
        chapters.find(c => c.id === reviewed.entryChapterId)?.id ?? chapters.find(c => !c.blocks.shotTextOrigin)?.id ?? chapters[0]?.id;
      window.dispatchEvent(new CustomEvent("dt:select-manuscript", {
        detail: { storyId, accountId: origin.current.accountId, kind: target, chapterId },
      }));
      if (target === "storyboard") {
        if (!chapterId) throw new Error(ui("当前分镜工作稿不存在"));
        const detail: StudioCreateRequest = { id: "film-" + reviewed.id, storyId, kind: "video", instruction: reviewed.request,
          storyboardChapterId: chapterId, approvedManuscriptFingerprint: version.fingerprint };
        if (window.location.pathname === "/editing") window.dispatchEvent(new CustomEvent(STUDIO_CREATE_EVENT, { detail }));
        else if (origin.current.accountId) window.location.assign(saveStudioCreateHandoff(sessionStorage, origin.current.accountId, detail));
      }
      onDone();
    });
  }
  useEffect(() => {
    if (!approveRef || !canApprove) return;
    approveRef.current = continueFilm;
    return () => { if (approveRef.current === continueFilm) approveRef.current = null; };
  });
  let shotNumber = 0, sceneNumber = 0;
  return <div className="space-y-3">
    {chatTurnId ? <p className="font-medium">{ui("分镜版")} · {ui(preview?.status === "adopted" ? "已确认" : "文字预览")}</p> :
      <p className="text-sm text-muted-foreground">{ui(target === "text" ? "将分镜改写成文字，原分镜和旧版本会保留。" : "先把书稿和聊天整理成可拍摄的分镜，确认后继续编排视频素材。旧版本会保留。")}</p>}
    {chapters && <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border p-3" aria-label={ui(target === "text" ? "文字预览" : "分镜预览")}>
      {chapters.map((c, i) => <section key={i}><h3 className="font-medium">{c.title}</h3>
        {writingModuleTexts(c.blocks.body, c.blocks.writingStyle).map((text, j) => {
          const media = readBookImage(text) ? ui("沿用原图") : readBookAudio(text) ? ui("沿用原声音素材") : null;
          const module = c.blocks.writingStyle?.[j];
          if (module?.format === "scene" && !showScenes) return null;
          const label = module?.format === "shot" ? ui("第 {0} 镜", [String(++shotNumber).padStart(2, "0")]) :
            module?.format === "scene" ? ui("第 {0} 场", [++sceneNumber]) : undefined;
          return editing && !media
            ? <textarea key={module?.id ?? j} disabled={busy} aria-label={ui("修改稿件文字") + " " + (i+1) + "." + (j+1)} className="my-1 w-full rounded border p-2" value={editing.values[i][j]}
                onChange={e => setEditing({ ...editing, values: editing.values.map((row, a) => a === i ? row.map((v, b) => b === j ? e.target.value : v) : row) })} />
            : <p key={module?.id ?? j} className={module?.format === "shot" ? "pt-2 font-semibold" : "whitespace-pre-wrap py-1 text-sm"}>
                {label && label + " · "}{media ?? text}</p>;
        })}</section>)}
    </div>}
    {(error || preview?.error || query.error) && <p role="alert" className="text-sm text-destructive">{error || preview?.error || query.error?.message}</p>}
    {preview?.status === "generating" && <p role="status">{ui("正在整理…")}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      {(!chatTurnId || !preview) && <button type="button" className={button} disabled={busy || !!editing || query.isLoading || query.isError} onClick={() => void prepareQuote()}>
        {ui(running ? "正在整理…" : preview?.chapters ? "按新想法重新生成" : target === "text" ? "生成文字" : "生成分镜")}</button>}
      {canReopen && <button type="button" className={button} onClick={continueFilm}>{ui("进入视频")}</button>}
      {preview?.status === "review" && preview.chapters && <>
        <button type="button" className={button} disabled={busy} onClick={() => editing ? void run(async () => { await saveEdits(); await query.refetch(); }) :
          setEditing({ id: preview.id, revision: preview.revision, values: preview.chapters!.map(c => writingModuleTexts(c.blocks.body, c.blocks.writingStyle)) })}>
          {ui(editing ? "保存预览修改" : "编辑文字")}</button>
        <button type="button" className={button} disabled={!canApprove} onClick={continueFilm}>{ui(target === "text" ? "确认文字新版本" : "确认分镜，进入视频")}</button>
      </>}
    </div>
    <Dialog open={Boolean(quote)} onOpenChange={open => { if (!open) setQuote(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{ui(target === "text" ? "生成文字" : "生成分镜")}</DialogTitle>
        <DialogDescription>{ui("本次文字生成报价")} {quote && formatComputeQuote(quote.amount).replace(/算力$/, ui("算力"))}</DialogDescription></DialogHeader>
        <button type="button" className={button} disabled={running || blocked} onClick={submitQuote}>{ui("确认报价并生成")}</button>
      </DialogContent>
    </Dialog>
  </div>;
}
