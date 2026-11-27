import { shotOutputLabels, type ShotOutput } from "@shared/bookShotActions";
import { useUiText } from "@/features/uiLanguage/UiLanguage";

export function ShotCueButton({ output, label, detail = "", disabled, onClick }: {
  output: ShotOutput;
  label: string;
  detail?: string;
  disabled?: boolean;
  onClick(): void;
}) {
  const ui = useUiText();
  const hint = ui(shotOutputLabels[output].hint);
  return <button type="button" disabled={disabled} aria-label={ui(label) + detail} aria-description={hint}
    className="group/cue inline-flex max-w-full items-baseline rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:text-foreground"
    onClick={event => { event.stopPropagation(); onClick(); }}>
    <span aria-hidden="true" className="inline-grid text-left">
      <span className="col-start-1 row-start-1 group-hover/cue:invisible group-focus-visible/cue:invisible">{ui(label)}</span>
      <span className="invisible col-start-1 row-start-1 underline underline-offset-2 group-hover/cue:visible group-focus-visible/cue:visible">{hint}</span>
    </span>{detail}
  </button>;
}
