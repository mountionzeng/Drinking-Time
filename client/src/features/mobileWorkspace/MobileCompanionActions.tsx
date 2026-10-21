import { useUiText } from "@/features/uiLanguage/UiLanguage";
import React, { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { MemoryFollowupSource } from "./mobileMemoryFollowup";

type Choice = {
  id: string;
  content: string;
  role: "user" | "assistant" | "note";
};
type Props = {
  storyId: number | null;
  source?: MemoryFollowupSource;
  draft: string;
  setDraft: (value: string) => void;
  messages: readonly Choice[];
  disabled: boolean;
  onLocked: (locked: boolean) => void;
  onNewStory?: () => void;
};
const button = "min-h-11 px-2 text-xs text-primary disabled:opacity-40";
const field =
  "w-full rounded-lg border border-border bg-background p-2 text-sm";

/** Mount API-backed controls only when requested, keeping the conversation readable. */
export function MobileCompanionActions(props: Props) {
  const t = useUiText();

  const [mode, setMode] = useState<"import" | "memory" | "text" | null>(null);
  return (
    <div className="shrink-0 border-t border-border/40 px-3">
      <div
        className="flex flex-wrap justify-between gap-x-2"
        aria-label={t("聊天内容操作")}
      >
        {(
          [
            ["import", t("导入本地文件")],
            ["text", t("加入某段文字")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={button}
            disabled={props.disabled || mode !== null}
            onClick={() => {
              setMode(id);
              props.onLocked(true);
            }}
          >
            {label}
          </button>
        ))}
        {props.onNewStory && (
          <button
            type="button"
            className={button}
            disabled={
              props.disabled || mode !== null || Boolean(props.draft.trim())
            }
            onClick={props.onNewStory}
          >
            {t("生成新的故事")}
          </button>
        )}
      </div>
      {mode && (
        <ActionEditor
          {...props}
          mode={mode}
          close={() => {
            setMode(null);
            props.onLocked(false);
          }}
        />
      )}
    </div>
  );
}
export function ActionEditor({
  mode,
  close,
  ...props
}: Props & { mode: "import" | "memory" | "text"; close: () => void }) {
  const t = useUiText();

  const utils = trpc.useUtils();
  const saveMemory = trpc.memoryWarehouse.save.useMutation({ retry: false });
  const revise = trpc.textDrafts.revise.useMutation({ retry: false });
  const saveBody = trpc.publishingDraft.saveBody.useMutation({ retry: false });
  const upload = trpc.creationAgent.importStoryMaterial.useMutation({
    retry: false,
  });
  const stories = trpc.storyAgent.storyList.useQuery();
  const [target, setTarget] = useState(props.storyId ?? 0);
  const history = trpc.textDrafts.read.useQuery(
    { storyId: target },
    { enabled: mode === "text" && target > 0, retry: false }
  );
  const current = trpc.publishingDraft.readBody.useQuery(
    { storyId: target },
    {
      enabled: mode === "text" && target > 0,
      retry: false,
      refetchOnWindowFocus: false,
    }
  );
  const materials = trpc.storyAgent.storyMaterialState.useQuery(
    { storyId: target },
    { enabled: mode === "import" && target > 0, retry: false }
  );
  const [versionId, setVersionId] = useState("");
  const [shot, setShot] = useState(props.source?.stableShotId ?? "");
  const choices = [
    ...(props.draft.trim()
      ? [{ id: "draft", content: props.draft, role: "user" as const }]
      : []),
    ...props.messages
      .filter(m => m.content.trim())
      .slice(-20)
      .reverse(),
    ...(props.source
      ? [
          {
            id: "source",
            content: props.source.content,
            role: props.source.origin,
          },
        ]
      : []),
  ];
  const initialChoice =
    mode === "text" ? choices.find(c => c.id !== "source") : choices[0];
  const [choice, setChoice] = useState(initialChoice?.id ?? "");
  const [body, setBody] = useState(initialChoice?.content ?? "");
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const lock = useRef(false);
  const token = useRef(crypto.randomUUID());
  const lastPayload = useRef("");
  const publishingBase = useRef(current.data);
  if (!lastPayload.current) publishingBase.current = current.data;
  const version = history.data?.versions.find(v => v.id === versionId);
  const content =
    versionId === "current" && current.data
      ? { title: "当前正文", body: current.data.body, tags: [] }
      : (version?.adoption?.content ?? version?.generated);
  const preview = content ? `${content.body}\n\n${body.trim()}` : "";
  async function submit() {
    if (lock.current || done) return;
    const payload = JSON.stringify({
      mode,
      target,
      versionId,
      body,
      title,
      choice,
    });
    if (lastPayload.current && lastPayload.current !== payload) {
      token.current = crypto.randomUUID();
      publishingBase.current = current.data;
    }
    lastPayload.current = payload;
    lock.current = true;
    setBusy(true);
    setStatus("");
    const importedMedia: string[] = [];
    try {
      if (mode === "memory") {
        if (!body.trim() || body.trim().length > 12000)
          throw new Error("请填写记忆内容，最多 12000 字。");
        await saveMemory.mutateAsync({
          id: token.current,
          title: title.trim() || body.trim().slice(0, 40),
          content: body.trim(),
          kind: "conversation",
          origin: choices.find(c => c.id === choice)?.role ?? "note",
          sourceStoryId: props.storyId,
        });
        void utils.memoryWarehouse.list.invalidate();
        if (props.storyId)
          void utils.memoryWarehouse.forStory.invalidate({
            storyId: props.storyId,
          });
        setStatus("已存为记忆，电脑端也能查看。");
      } else if (mode === "text") {
        if (
          !target ||
          !content ||
          !body.trim() ||
          (versionId !== "current" && (!version || !history.data))
        )
          throw new Error("请选择文字版本并填写要加入的内容。");
        if (preview.length > 20000)
          throw new Error("合并后的文字超过 20000 字，请缩短补充内容。");
        if (versionId === "current" && current.data) {
          const result = await saveBody.mutateAsync({
            storyId: target,
            versionId: publishingBase.current!.versionId,
            platform: publishingBase.current!.platform,
            baseBodyRevision: publishingBase.current!.bodyRevision,
            body: preview,
          });
          if (result.status !== "saved")
            throw new Error(
              "正文已在其他地方更新，补充内容仍保留。请重新读取目标，查看预览后再加入。"
            );
          utils.publishingDraft.readBody.setData(
            { storyId: target },
            result.document
          );
          void utils.publishingDraft.read.invalidate({ storyId: target });
          setStatus("已补充到当前正文，原有段落保留。");
        } else {
          const result = await revise.mutateAsync({
            storyId: target,
            versionId: version!.id,
            operationToken: token.current,
            expectedRevision: history.data!.revision,
            content: { ...content, body: preview },
          });
          utils.textDrafts.read.setData({ storyId: target }, result.history);
          setStatus("已加入并另存一版文字，原稿保留。");
        }
      } else {
        if (!files.length) throw new Error("请先选择文件。");
        const textFiles = files.filter(
          file =>
            /\.(txt|md|csv|json|html|xml)$/i.test(file.name) ||
            file.type.startsWith("text/")
        );
        const mediaFiles = files.filter(file => !textFiles.includes(file));
        const importedText: string[] = [];
        for (const file of textFiles) {
          if (file.size > 100000)
            throw new Error(`${file.name} 超过 100KB，请先拆分文件。`);
          const text = await file.text();
          if (!text.trim() || text.includes("\u0000"))
            throw new Error(`${file.name} 不是可读取的 UTF-8 文本文件。`);
          importedText.push(`【文件：${file.name}】\n${text}`);
        }
        if (mediaFiles.length && !target)
          throw new Error("请先选择故事，图片和视频会导入到该故事的素材库。");
        const unsupported = mediaFiles.find(
          file =>
            !file.type.startsWith("image/") && !file.type.startsWith("video/")
        );
        if (unsupported)
          throw new Error(
            `${unsupported.name} 暂不支持解析。可导入图片、视频、TXT、MD、CSV、JSON、HTML、XML。`
          );
        for (const file of mediaFiles) {
          const isVideo = file.type.startsWith("video/");
          if (file.size > (isVideo ? 200 : 30) * 1024 * 1024)
            throw new Error(
              isVideo ? `${file.name} 超过 200MB。` : `${file.name} 超过 30MB。`
            );
        }
        if (
          mediaFiles.some(file => file.type.startsWith("video/")) &&
          (!shot || !materials.data?.shots.some(s => s.stableShotId === shot))
        )
          throw new Error("请先选择视频所属镜头；没有镜头时需先在电脑端创建。");
        const nextText = [
          props.draft,
          importedText.length
            ? "请阅读我导入的文件文本，按文件逐项概括，并建议分别归类为回忆、文章文字、视频说明或其他；不要把推测当成事实。\n\n" +
              importedText.join("\n\n")
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        if (nextText.length > 12000)
          throw new Error("导入后超过 12000 字，请先拆分文件。");
        for (const file of mediaFiles) {
          const video = file.type.startsWith("video/");
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error(`${file.name} 读取失败`));
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.readAsDataURL(file);
          });
          const result = await upload.mutateAsync({
            storyId: target,
            fileName: file.name,
            mimeType: file.type,
            fileBase64: base64,
            targetStableShotId: video ? shot : null,
            note: title.trim() || undefined,
          });
          if (result.status !== "ok")
            throw new Error(result.error || `${file.name} 导入失败`);
          importedMedia.push(file.name);
        }
        if (importedText.length) {
          props.setDraft(nextText);
        }
        if (importedMedia.length) {
          void utils.storyAgent.storyImages.invalidate({ storyId: target });
          void utils.storyAgent.storyVideoAssets.invalidate({
            storyId: target,
          });
          void utils.storyAgent.storyMaterialState.invalidate({
            storyId: target,
          });
        }
        setStatus(
          `${importedText.length ? `已读取 ${importedText.length} 个文本文件并放入聊天输入框。` : ""}${importedMedia.length ? `已导入 ${importedMedia.length} 个图片/视频到故事素材。` : ""} 文本发送后 AI 才会整理；图片和视频当前只保存素材与说明，不会自动识别画面。`
        );
      }
      setDone(true);
    } catch (error) {
      setStatus(
        `${error instanceof Error ? error.message : "没有保存成功，请重试。"}${importedMedia.length ? ` 已部分导入：${importedMedia.join("、")}。重试前请先检查素材库。` : ""}`
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      aria-label={t("聊天操作预览")}
      className="max-h-[35dvh] overflow-y-auto pb-3 space-y-2"
    >
      {!done && (
        <fieldset disabled={busy} className="space-y-2">
          {mode !== "memory" && (
            <label className="block text-xs">
              {t("目标故事")}
              <select
                className={field}
                value={target}
                onChange={e => {
                  setTarget(Number(e.target.value));
                  setVersionId("");
                  setShot("");
                }}
              >
                <option value={0}>{t("选择故事")}</option>
                {stories.data?.stories.map(s => (
                  <option value={s.id} key={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {stories.isError && (
            <p role="alert">
              {t("故事未加载。")}
              <button onClick={() => void stories.refetch()}>
                {t("重试")}
              </button>
            </p>
          )}
          {mode === "import" ? (
            <>
              <p className="text-xs text-muted-foreground">
                {t(
                  "可多选：图片 ≤30MB、视频 ≤200MB、文本/CSV/JSON/HTML/XML ≤100KB。文本会进入聊天，媒体保存到故事素材。"
                )}
              </p>
              <input
                aria-label={t("本地文件")}
                type="file"
                accept="image/*,video/*,text/*,.txt,.md,.csv,.json,.html,.xml"
                multiple
                className={field}
                onChange={e => setFiles(Array.from(e.target.files ?? []))}
              />
              {files.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  已选择 {files.length} 个文件：
                  {files.map(file => file.name).join("、")}
                </p>
              )}
              <input
                aria-label={t("素材说明")}
                placeholder={t("素材说明（可选）")}
                maxLength={2000}
                className={field}
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
              {files.some(file => file.type.startsWith("video/")) && (
                <label className="block text-xs">
                  {t("视频镜头")}
                  <select
                    className={field}
                    value={shot}
                    onChange={e => setShot(e.target.value)}
                  >
                    <option value="">{t("选择镜头")}</option>
                    {materials.data?.shots.map(s => (
                      <option key={s.stableShotId} value={s.stableShotId}>
                        {s.shotNo}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          ) : (
            <>
              <select
                aria-label={t("选取聊天内容")}
                className={field}
                value={choice}
                onChange={e => {
                  setChoice(e.target.value);
                  setBody(
                    choices.find(c => c.id === e.target.value)?.content ?? ""
                  );
                }}
              >
                <option value="">{t("自己填写")}</option>
                {choices.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.id === "draft"
                      ? t("输入框")
                      : c.id === "source"
                        ? t("当前上下文")
                        : c.role === "assistant"
                          ? t("小忆回复")
                          : c.role === "note"
                            ? t("已保存内容")
                            : t("我的话")}{" "}
                    · {c.content.slice(0, 30)}
                  </option>
                ))}
              </select>
              {mode === "memory" && (
                <input
                  aria-label={t("记忆标题")}
                  placeholder={t("记忆标题（可选）")}
                  maxLength={120}
                  className={field}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                />
              )}
              <textarea
                aria-label={t("要保存的内容")}
                rows={3}
                className={field}
                value={body}
                maxLength={12000}
                onChange={e => setBody(e.target.value)}
              />
              {mode === "text" && (
                <>
                  <select
                    aria-label={t("目标文字版本")}
                    className={field}
                    value={versionId}
                    onChange={e => setVersionId(e.target.value)}
                  >
                    <option value="">{t("选择一段文字")}</option>
                    {current.data && (
                      <option value="current">
                        {t("当前正文 · 补充到末尾")}
                      </option>
                    )}
                    {history.data?.versions
                      .filter(v => v.adoption?.content || v.generated)
                      .map(v => (
                        <option value={v.id} key={v.id}>
                          {(v.adoption?.content ?? v.generated)?.title}{" "}
                          {t("· 版本")} {v.sequence}
                        </option>
                      ))}
                  </select>
                  {history.isError && (
                    <p role="alert">
                      {t("文字未加载。")}
                      <button onClick={() => void history.refetch()}>
                        {t("重试")}
                      </button>
                    </p>
                  )}
                  {target > 0 &&
                    history.data &&
                    !current.data &&
                    !current.isLoading &&
                    !history.data.versions.some(
                      v => v.adoption?.content || v.generated
                    ) && (
                      <p className="text-xs">
                        {t(
                          "这个故事还没有可加入的文字版本，请先选择已有文字的故事。"
                        )}
                      </p>
                    )}
                  {status && (
                    <button
                      className={button}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          if (versionId === "current") {
                            const latest = await current.refetch();
                            if (latest.error) throw latest.error;
                            publishingBase.current = latest.data;
                          } else {
                            const latest = await history.refetch();
                            if (latest.error) throw latest.error;
                          }
                          setStatus(
                            t("目标已重新读取，请核对合并预览后再保存。")
                          );
                        } catch {
                          setStatus(t("读取失败，补充内容仍保留，请重试。"));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {t("重新读取目标")}
                    </button>
                  )}
                  {current.isError &&
                    current.error?.data?.code !== "BAD_REQUEST" && (
                      <p role="alert">
                        {t("当前正文未读取成功。")}
                        <button onClick={() => void current.refetch()}>
                          {t("重试")}
                        </button>
                      </p>
                    )}
                  {content && (
                    <details>
                      <summary className="text-xs text-primary">
                        {t("预览合并后的文字")}
                      </summary>
                      <p className="whitespace-pre-wrap text-sm">{preview}</p>
                    </details>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {versionId === "current"
                      ? t("补充到当前正文末尾；保留已有段落，并同步到电脑。")
                      : t("补充到末尾，另存新版本，不自动采用。")}
                  </p>
                </>
              )}
            </>
          )}
        </fieldset>
      )}
      {status && (
        <p role="status" className="text-xs leading-5">
          {status}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <button className={button} disabled={busy} onClick={close}>
          {done ? t("完成") : t("取消")}
        </button>
        {!done && (
          <button className={button} disabled={busy} onClick={submit}>
            {busy
              ? t("正在保存…")
              : mode === "import"
                ? t("导入")
                : mode === "memory"
                  ? t("保存记忆")
                  : t("确认加入")}
          </button>
        )}
      </div>
    </section>
  );
}
