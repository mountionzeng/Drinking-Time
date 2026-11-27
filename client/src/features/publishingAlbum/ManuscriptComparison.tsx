import { useMemo, useState } from "react";
import type {
  ManuscriptContent,
  BookWorkflowState,
  ConversionDraft,
  ManuscriptKind,
} from "@shared/bookWorkflow";
import { writingModuleTexts } from "@shared/bookWritingStyle";
import { readBookImage } from "@shared/bookImageBlock";
import { readBookAudio } from "@shared/bookAudioBlock";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { ChangedText } from "./WritingComparison";
import { textChanges } from "./textChanges";

export type ComparisonChapter = Pick<ManuscriptContent, "title" | "blocks">;

type ManuscriptChoice = {
  id: string;
  label: string;
  chapters: ComparisonChapter[];
  partial?: boolean;
};

export function trialComparisonLabel(trial: ConversionDraft) {
  return trial.trial?.label || trial.chapters?.[0]?.title || trial.request;
}

export function manuscriptChoices(
  state: BookWorkflowState,
  kind: ManuscriptKind,
  label: string,
  draftLabel: string
): ManuscriptChoice[] {
  const saved = state.versions.filter(v => v.kind === kind);
  const trials = state.conversions.flatMap(trial => {
    if (
      trial.target !== kind ||
      trial.status !== "review" ||
      !trial.chapters?.length
    )
      return [];
    const chapters = trial.chapters;
    const refs = trial.revisedChapters;
    const choice = {
      id: trial.id,
      label: trialComparisonLabel(trial) + " · " + draftLabel,
      chapters,
    };
    if (!refs?.length) return [choice];
    // Only the original immutable target can supply chapters omitted from a scoped draft.
    const base = saved.find(v => v.fingerprint === trial.targetFingerprint);
    if (
      !base ||
      refs.length !== chapters.length ||
      refs.some(r => !base.chapters[r.index])
    )
      return [{ ...choice, partial: true }];
    const full = [...base.chapters];
    refs.forEach((ref, i) => {
      full[ref.index] = chapters[i];
    });
    return [{ ...choice, chapters: full }];
  });
  return [
    ...saved.map(v => ({
      id: v.id,
      label: label + " V" + v.number,
      chapters: v.chapters,
    })),
    ...trials,
  ].reverse();
}

export function ManuscriptComparison({
  selectedId,
  state,
  kind,
  working,
  close,
}: {
  selectedId: string;
  state: BookWorkflowState;
  kind: ManuscriptKind;
  working: ComparisonChapter[];
  close(): void;
}) {
  const ui = useUiText();
  const [rightId, setRightId] = useState("");
  const kindLabel = ui(kind === "text" ? "文字版" : "分镜版");
  const draftLabel = ui("已保存试稿");
  const versions = useMemo(
    () => manuscriptChoices(state, kind, kindLabel, draftLabel),
    [state, kind, kindLabel, draftLabel]
  );
  const version = versions.find(v => v.id === selectedId);
  const other = versions.find(v => v.id === rightId && v.id !== selectedId);
  const right = other?.chapters ?? working;
  const changes = useMemo(() => {
    // Give the same embedded media the same number on both sides, even when moved.
    const media = new Map<string, number>();
    const manuscript = (chapters: ComparisonChapter[]) =>
      chapters
        .map(c => {
          const lines = writingModuleTexts(
            c.blocks.body,
            c.blocks.writingStyle
          ).map(raw => {
            const image = readBookImage(raw);
            const audio = image ? null : readBookAudio(raw);
            if (!image && !audio) return raw;
            if (!media.has(raw)) media.set(raw, media.size + 1);
            return (
              "〔" +
              (audio ? audio.label : ui(image?.videoUrl ? "视频" : "图片")) +
              " " +
              media.get(raw) +
              (audio?.title ? " · " + audio.title : "") +
              "〕"
            );
          });
          return [c.title, ...lines].join("\n");
        })
        .join("\n\n");
    return textChanges(manuscript(version?.chapters ?? []), manuscript(right));
  }, [version, right, ui]);
  if (!version) return null;
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] w-[96vw] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{ui("稿件对比")}</DialogTitle>
          <DialogDescription>
            {changes.some(part => part.kind !== "same")
              ? ui("删除线标出左稿独有的内容，下划线标出右稿独有的内容。")
              : ui("两份稿件的标题、正文和内嵌素材相同。")}
            {(version.partial || other?.partial) &&
              " " + ui("本次试稿只保存了选中的章节。")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <article aria-label={ui("所选稿件")}>
            <h3 className="mb-2 font-medium">{version.label}</h3>
            <div className="select-text whitespace-pre-wrap break-words text-sm">
              <ChangedText changes={changes} side="before" />
            </div>
          </article>
          <article
            aria-label={ui("对照稿件")}
            className="border-t pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0"
          >
            <select
              aria-label={ui("对照稿件")}
              value={other?.id ?? ""}
              className="mb-2 max-w-full rounded border bg-transparent px-2 py-1 text-sm"
              onChange={e => setRightId(e.target.value)}
            >
              <option value="">
                {kindLabel} · {ui("当前工作稿")}
              </option>
              {versions
                .filter(v => v.id !== version.id)
                .map(v => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
            </select>
            <div className="select-text whitespace-pre-wrap break-words text-sm">
              <ChangedText changes={changes} side="after" />
            </div>
          </article>
        </div>
      </DialogContent>
    </Dialog>
  );
}
