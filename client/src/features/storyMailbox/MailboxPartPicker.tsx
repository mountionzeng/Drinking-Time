import type { MailboxPart } from "@shared/storyMailboxSelection";
import { useUiText } from "@/features/uiLanguage/UiLanguage";

export function MailboxPartPicker({
  parts,
  value,
  onChange,
  disabled,
  continuous = true,
}: {
  parts: MailboxPart[];
  value: string[];
  onChange: (keys: string[]) => void;
  disabled?: boolean;
  continuous?: boolean;
}) {
  const t = useUiText();
  const labels = { text: "文字", image: "图片", video: "视频", audio: "声音" };
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="mb-2 text-sm font-medium">
        {t("勾选要发送的部分")}
      </legend>
      <p className="text-xs leading-5 text-muted-foreground">
        {t(
          continuous
            ? "只共享勾选部分及其后续修改。其他段落、新增内容、旧版本和剪辑线保持私密。"
            : "小程序接收的是本次所选内容的独立副本。其他内容保持私密；后续修改需要再次发送。"
        )}
      </p>
      <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
        {parts.map(part => (
          <label
            key={part.key}
            className="flex cursor-pointer gap-3 px-3 py-3 hover:bg-muted"
          >
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 accent-primary"
              checked={value.includes(part.key)}
              onChange={e =>
                onChange(
                  e.target.checked
                    ? [...value, part.key]
                    : value.filter(k => k !== part.key)
                )
              }
            />
            <span className="min-w-0 text-sm">
              <span className="block text-xs text-muted-foreground">
                {part.group} · {t(labels[part.kind])}
              </span>
              <span className="block whitespace-pre-wrap break-words">
                {part.label}
              </span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs" role="status">
        {t("已选择 {0} 项", [value.length])}
      </p>
    </fieldset>
  );
}
