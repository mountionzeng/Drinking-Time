import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { useState } from "react";
import { ChevronDown, ImagePlus, Music2, Video } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const STUDIO_CREATE_EVENT = "dt:studio-create";
export type StudioCreateRequest = {
  id: string;
  storyId: number;
  kind: "image" | "video" | "music" | "layout";
  instruction: string;
  warehouseImage?: { imageId: number; role: 'cover' | 'illustration' | 'background' };
};

export function StudioCreateMenu({
  storyId, input, blocked, onCreate,
}: {
  storyId: number | null;
  input: string;
  blocked: boolean;
  hasShots: boolean;
  onCreate?: (request: StudioCreateRequest) => void;
}) {
  const _ui = useDesktopUiText();
  const [open, setOpen] = useState(false);
  const hasStory = storyId !== null && storyId > 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button"
          className="mt-1 inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[var(--panel-border)] px-2 text-[11px] font-medium text-[var(--nayin-accent)] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]">
          {_ui("基于当前内容生成")}{" "}<ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <p className="px-2 py-2 text-xs text-muted-foreground">{_ui("使用当前故事。图片、音乐会带上输入框里的要求；视频从已保存文案开始。")}</p>
        {(!hasStory || blocked) && (
          <p role="status" className="px-2 pb-2 text-xs text-muted-foreground">
            {!hasStory ? _ui("请先打开一个故事，再继续创作。") : _ui("聊天正在处理内容，完成后可继续生成。")}
          </p>
        )}
        {([
          ["image", "图片", ImagePlus],
          ["video", "视频", Video],
          ["music", "音乐", Music2],
        ] as const).map(([kind, label, Icon]) => (
          <button key={kind} type="button" disabled={!hasStory || blocked}
            onClick={() => {
              if (!storyId || storyId <= 0) return;
              const request = { id: crypto.randomUUID(), storyId, kind, instruction: input.trim() };
              if (onCreate) onCreate(request);
              else window.dispatchEvent(new CustomEvent<StudioCreateRequest>(STUDIO_CREATE_EVENT, { detail: request }));
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] disabled:opacity-45">
            <Icon className="h-4 w-4" />{_ui(label)}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
