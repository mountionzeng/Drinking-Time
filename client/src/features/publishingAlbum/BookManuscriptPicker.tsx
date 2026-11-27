import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger } from "@/components/ui/select";
import { MediaPlayer } from "@/components/ui/media-player";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import type { ConversionDraft, ManuscriptKind, ManuscriptVersion } from "@shared/bookWorkflow";
import { writingModuleTexts } from "@shared/bookWritingStyle";
import { bookBlockNumbers } from "@shared/bookBlockNumbering";
import { readBookImage } from "@shared/bookImageBlock";
import { readBookAudio } from "@shared/bookAudioBlock";
import { readShotField } from "@shared/bookShotFormat";
import { BookInlineImage } from "./BookImageCrop";
import { trialComparisonLabel } from "./ManuscriptComparison";
import { shotActionHeading, type ShotOutput } from "@shared/bookShotActions";
import { ShotCueButton } from "./ShotCueButton";
import { shotCueSourceKey } from "./savedShotCue";

type PickerProps = {
  value: string;
  kind: ManuscriptKind;
  versions: ManuscriptVersion[];
  readings: ConversionDraft[];
  disabled: boolean;
  shotDraftNumber?: number;
  onSelect(value: string): void;
};

export function BookManuscriptPicker({ value, kind, versions, readings, disabled, shotDraftNumber, onSelect }: PickerProps) {
  const ui = useUiText();
  const order = [kind, kind === "text" ? "storyboard" : "text"] as const;
  const selected = versions.find(v => v.id === value);
  const trial = readings.find(d => d.id === value);
  const kindName = ui(kind === "text" ? "文字版" : "分镜版");
  const workingName = (k: ManuscriptKind) => k === "storyboard" && shotDraftNumber
    ? ui("第 {0} 镜工作稿", [String(shotDraftNumber).padStart(2,"0")]) : ui("当前工作稿");
  const caption = selected ? kindName + " V" + selected.number : trial ? trialComparisonLabel(trial)
    : value === "text" || value === "storyboard" ? kindName + " · " + workingName(kind) : ui("选择版本");
  return <Select value={value} disabled={disabled} onValueChange={onSelect}>
    <SelectTrigger size="sm" aria-label={ui("查看稿件版本")} className="max-w-full">
      <span className="text-muted-foreground">{ui("版本")}</span><span className="truncate">{caption}</span>
    </SelectTrigger>
    <SelectContent align="start" className="max-h-[min(65dvh,28rem)] max-w-[min(90vw,30rem)]">
      {order.map(k => {
        const name = ui(k === "storyboard" ? "分镜版" : "文字版");
        return <SelectGroup key={k}>
          <SelectLabel>{name}</SelectLabel>
          <SelectItem value={k}>{name} · {workingName(k)}</SelectItem>
          {k === "storyboard" && shotDraftNumber && <SelectItem value="storyboard:main">{name} · {ui("全片工作稿")}</SelectItem>}
          {versions.filter(v => v.kind === k).sort((a,b) => b.number - a.number).map(v =>
            <SelectItem key={v.id} value={v.id} textValue={name+" V"+v.number}>
              <span className="shrink-0">{name} V{v.number}</span>
              <span className="truncate text-xs text-muted-foreground">{v.summary}</span>
            </SelectItem>)}
          {k === "storyboard" && readings.map(d => <SelectItem key={d.id} value={d.id}>
            {trialComparisonLabel(d)} · {ui("试稿")}
          </SelectItem>)}
        </SelectGroup>;
      })}
    </SelectContent>
  </Select>;
}

export type SavedShotCue = { moduleId: string; output: ShotOutput; sourceKey: string; originTrialId?: string };

export function SavedManuscriptReader({ version, onProduce, busy }: {
  version: ManuscriptVersion;
  onProduce?(cue: SavedShotCue): void;
  busy?: boolean;
}) {
  const ui = useUiText();
  let preceding = 0;
  const label = ui(version.kind === "text" ? "文字版" : "分镜版") + " V" + version.number;
  return <article aria-label={label} className="space-y-6 break-words">
    <header><h2 className="text-base font-semibold">{label} · {ui("已保存")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{version.summary}</p></header>
    {version.chapters.map((chapter, i) => {
      const { body, writingStyle, shotTextOrigin } = chapter.blocks;
      const texts = writingModuleTexts(body, writingStyle);
      const rows = (writingStyle ?? []).map((row, index) => ({...row, text: texts[index]}));
      const numbers = bookBlockNumbers(writingStyle ?? [], shotTextOrigin ? (shotTextOrigin.shotNo ?? 1) - 1 : preceding);
      if (!shotTextOrigin) preceding += writingStyle?.filter(r => r.format === "shot").length ?? 0;
      return <section key={i} className="space-y-2">
        <h3 className="text-lg font-medium">{chapter.title}</h3>
        {texts.map((text,index) => {
          const row = writingStyle?.[index], key = row?.id ?? index;
          if (row?.format === "shot") return <h4 key={key} className="pt-4 font-semibold">
            {ui("第 {0} 镜", [String(numbers.get(row.id)?.shotNumber).padStart(2,"0")])} · {text}</h4>;
          if (readBookImage(text)) return <div key={key} className="h-48 max-w-md"><BookInlineImage text={text}/></div>;
          const audio = readBookAudio(text);
          if (audio) return <MediaPlayer key={key} kind="audio" controls preload="none" aria-label={audio.title} src={audio.url}/>;
          const field = readShotField(text);
          const cue = onProduce && version.kind === "storyboard" && row?.format === "text" &&
            row.parentId && rows.some(parent => parent.id === row.parentId && parent.format === "shot") && shotActionHeading(text);
          if (cue && (row?.videoRole !== "dialogue" || cue.output === "narration")) {
            const label = cue.label.split(/[｜|（(]/u)[0];
            return <div key={key} className="whitespace-pre-wrap leading-relaxed">
              <ShotCueButton label={label} detail={cue.detail} output={cue.output} disabled={busy} onClick={() => {
                const sourceKey = shotCueSourceKey(rows, index, cue.output);
                if (sourceKey) onProduce({moduleId: row.id, output: cue.output, sourceKey, originTrialId: shotTextOrigin?.trialId});
              }}/>
              {cue.inline && <p>{cue.inline}</p>}
            </div>;
          }
          const separator = text.search(/[：:]/u);
          return <p key={key} className="whitespace-pre-wrap leading-relaxed">{field && row?.videoRole !== "dialogue"
            ? <><span className="block text-xs font-medium text-muted-foreground">{separator < 0 ? text : text.slice(0,separator)}</span>{separator >= 0 && text.slice(separator+1)}</>
            : text}</p>;
        })}
      </section>;
    })}
  </article>;
}
