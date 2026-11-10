import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { displayShotCode } from "@shared/shotIdentity";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import type { StoryShot } from "../types";
import type { StoryboardMatrixField } from "./StoryboardMatrix";

export type ManuscriptEntry = {
  shot: StoryShot;
  stableShotId: string;
  originalIndex: number;
};
type Props = {
  visible: boolean;
  entries: readonly ManuscriptEntry[];
  selectedShotNo: number | null;
  onSelect: (shotNo: number) => void;
  renderMedia: (entry: ManuscriptEntry) => ReactNode;
  onSave: (
    entry: ManuscriptEntry,
    field: StoryboardMatrixField,
    value: string
  ) => Promise<unknown>;
  onGenerate: (
    entry: ManuscriptEntry,
    kind: "image" | "video" | "voice"
  ) => void;
  isBusy: (entry: ManuscriptEntry) => boolean;
  voiceError: (entry: ManuscriptEntry) => string | undefined;
  timingLabel: (entry: ManuscriptEntry) => string;
};

const columns = [
  {
    title: "画面与动作",
    fields: [
      ["action", "画面动作"],
      ["promptDraft", "图片要求"],
    ],
  },
  {
    title: "台词与字幕",
    fields: [
      ["dialogue", "台词 / 旁白"],
      ["scriptText", "剧本"],
    ],
  },
  {
    title: "运动与衔接",
    fields: [
      ["cameraMove", "运镜"],
      ["videoPrompt", "视频要求"],
      ["transitionOut", "衔接"],
    ],
  },
  { title: "音乐与音效", fields: [["sound", "背景音 / 音效"]] },
] as const;

function Field({
  value,
  label,
  visible,
  onSave,
  onState,
}: {
  visible: boolean;
  value: string;
  label: string;
  onSave: (value: string) => Promise<unknown>;
  onState: (blocked: boolean) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);
  useEffect(() => {
    const textarea = input.current;
    if (!textarea || !visible) return;
    let width = -1;
    const fit = () => {
      const nextWidth = textarea.clientWidth;
      if (nextWidth === width) return;
      width = nextWidth;
      if (nextWidth === 0) return;
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    fit();
    // The whole editor is temporarily hidden while reviewing a candidate.
    // Re-measure when it is revealed or resized; don't turn hidden height into 0px.
    const observer = new ResizeObserver(fit);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [draft, visible]);
  async function save() {
    if (!dirty.current || saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
      dirty.current = false;
      onState(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "保存失败，请重新编辑后重试"
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <label className="mb-3 block last:mb-0">
      <span className="mb-1 block text-[10px] text-muted-foreground">
        {label}
        {saving ? " · 保存中" : ""}
      </span>
      <textarea
        ref={input}
        rows={2}
        aria-label={label}
        value={draft}
        disabled={saving}
        onChange={event => {
          setDraft(event.target.value);
          dirty.current = true;
          onState(true);
        }}
        onBlur={() => void save()}
        className="block min-h-10 w-full resize-y rounded bg-transparent px-1 py-0.5 text-xs leading-6 outline-none focus:bg-muted/40 focus:ring-1 focus:ring-[var(--nayin-accent)]/40"
      />
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </label>
  );
}

function Row({ entry, ...props }: Props & { entry: ManuscriptEntry }) {
  const t = useUiText();
  const [blocked, setBlocked] = useState<
    Partial<Record<StoryboardMatrixField, boolean>>
  >({});
  const [menuOpen, setMenuOpen] = useState(false);
  const { shot } = entry;
  const label = displayShotCode(shot);
  const disabled = props.isBusy(entry) || Object.values(blocked).some(Boolean);
  return (
    <tr
      data-shot-id={entry.stableShotId}
      data-shot-code={label}
      onFocus={() => props.onSelect(shot.shotNo)}
      className={`align-top border-b border-border/60 ${props.selectedShotNo === shot.shotNo ? "bg-[var(--nayin-accent)]/5" : ""}`}
    >
      <th scope="row" className="w-24 px-3 py-4 text-left font-normal">
        <button
          type="button"
          onClick={() => props.onSelect(shot.shotNo)}
          aria-pressed={props.selectedShotNo === shot.shotNo}
          className="rounded text-sm font-semibold tabular-nums focus-visible:ring-2 focus-visible:ring-primary"
        >
          {label}
        </button>
        <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
          {shot.sceneTitle || shot.sceneNo}
        </p>
        <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
          {props.timingLabel(entry)}
        </p>
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={t("生成 {0} 的素材", [label])}
              className="mt-3 inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium text-[var(--nayin-accent)] disabled:opacity-40"
            >
              {t(props.isBusy(entry) ? "处理中" : "生成")}
              <ChevronDown className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-40 p-1">
            {(
              [
                ["image", "图片"],
                ["video", "视频"],
                ["voice", "声音 · 朗读台词"],
              ] as const
            ).map(([kind, title]) => (
              <button
                key={kind}
                type="button"
                disabled={
                  disabled || (kind === "voice" && !shot.dialogue?.trim())
                }
                className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-muted focus-visible:bg-muted disabled:opacity-40"
                onClick={() => {
                  setMenuOpen(false);
                  props.onGenerate(entry, kind);
                }}
              >
                {t(title)}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        {Object.values(blocked).some(Boolean) && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            {t("保存文字后可生成")}
          </p>
        )}
        {props.voiceError(entry) && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {props.voiceError(entry)}
          </p>
        )}
      </th>
      <td className="w-44 px-3 py-4">
        {props.renderMedia(entry)}
        <p className="mt-2 text-xs leading-5">{shot.subject}</p>
      </td>
      {columns.map(column => (
        <td key={column.title} className="min-w-40 px-3 py-4">
          {column.fields.map(([field, fieldLabel]) => (
            <Field
              key={field}
              visible={props.visible}
              label={`${label} · ${t(fieldLabel)}`}
              value={shot[field] ?? ""}
              onSave={value => props.onSave(entry, field, value)}
              onState={pending =>
                setBlocked(previous => ({ ...previous, [field]: pending }))
              }
            />
          ))}
          {column.title === "台词与字幕" && shot.voiceAudioUrl && (
            <audio
              controls
              preload="none"
              src={shot.voiceAudioUrl}
              aria-label={`${label} · ${t("旁白")}`}
              className="mt-2 h-8 w-full min-w-0"
            />
          )}
          {column.title === "台词与字幕" &&
            shot.voiceAudioUrl &&
            shot.voiceAudioText?.trim() !== shot.dialogue?.trim() && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                {t("这是上一版旁白，台词修改后可重新生成。")}
              </p>
            )}
        </td>
      ))}
    </tr>
  );
}

/** A projection of the live editor. No copied plan or second persistence owner. */
export function StoryboardManuscriptTable(props: Props) {
  const t = useUiText();
  return (
    <table
      aria-label={t("当前视频分镜稿")}
      className="w-full min-w-[1040px] table-fixed border-collapse"
    >
      <colgroup>
        <col className="w-24" />
        <col className="w-44" />
        <col />
        <col />
        <col />
        <col className="w-[16%]" />
      </colgroup>
      <thead className="sticky top-0 z-10 bg-background text-left text-xs text-muted-foreground">
        <tr>
          {["镜头", "画面素材", ...columns.map(column => column.title)].map(
            title => (
              <th
                key={title}
                scope="col"
                className="border-b px-3 py-3 font-medium"
              >
                {t(title)}
              </th>
            )
          )}
        </tr>
      </thead>
      <tbody>
        {props.entries.map(entry => (
          <Row key={entry.stableShotId} {...props} entry={entry} />
        ))}
      </tbody>
    </table>
  );
}
