import { MobileSheet } from "@/features/mobileWorkspace/MobileSheet";
import type {
  ImagePackModule,
  ModuleDocument,
  TextModule,
} from "./imagePackModules";

const action =
  "min-h-11 rounded px-3 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40";

export function MobileModuleTools({
  open,
  onOpenChange,
  module,
  pages,
  pageIndex,
  disabled,
  onEdit,
  onCrop,
  onChange,
  onMove,
  onDelete,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  module: ImagePackModule;
  pages: ModuleDocument["pages"];
  pageIndex: number;
  disabled: boolean;
  onEdit(): void;
  onCrop(): void;
  onChange(change: Partial<Pick<TextModule, "emphasis" | "backdrop">>): void;
  onMove(index: number): void;
  onDelete(): void;
}) {
  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={module.kind === "text" ? "文字模块操作" : "图片模块操作"}
    >
      <div className="flex flex-col gap-2">
        {module.kind === "text" ? (
          <>
            <button
              type="button"
              className={action}
              disabled={disabled}
              onClick={onEdit}
            >
              编辑文字
            </button>
            <div
              className="grid grid-cols-2 gap-2"
              role="group"
              aria-label="文字样式"
            >
              {(
                [
                  ["normal", "正常"],
                  ["bright", "加粗提亮"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`${action} border ${(module.emphasis ?? "normal") === value ? "border-primary bg-primary/10" : "border-border"}`}
                  aria-pressed={(module.emphasis ?? "normal") === value}
                  disabled={disabled}
                  onClick={() => onChange({ emphasis: value })}
                >
                  {label}
                </button>
              ))}
            </div>
            <label
              className={`${action} flex items-center justify-between gap-3`}
            >
              半透明底色
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={module.backdrop ?? false}
                disabled={disabled}
                onChange={event => onChange({ backdrop: event.target.checked })}
              />
            </label>
          </>
        ) : (
          <button
            type="button"
            className={action}
            disabled={disabled}
            onClick={onCrop}
          >
            裁切图片
          </button>
        )}
        <label className="flex min-h-11 items-center justify-between gap-3 px-3 text-sm">
          移到其他页
          <select
            aria-label="移到其他页"
            value=""
            className="min-h-11 min-w-0 max-w-[65%] rounded border border-border bg-background px-2 text-base"
            disabled={disabled}
            onChange={event => {
              if (event.target.value !== "") onMove(Number(event.target.value));
            }}
          >
            <option value="">选择目标页</option>
            {pages.map((page, index) => (
              <option key={index} value={index} disabled={index === pageIndex}>
                第 {index + 1} 页 · {page.label}
                {index === pageIndex ? "（当前页）" : ""}
              </option>
            ))}
            <option value={pages.length} disabled={pages.length >= 9}>
              {pages.length >= 9 ? "已达 9 页上限" : "移到新一页"}
            </option>
          </select>
        </label>
        <button
          type="button"
          className={`${action} border-t border-border text-destructive`}
          disabled={disabled}
          onClick={onDelete}
        >
          删除{module.kind === "text" ? "文字" : "图片"}模块
        </button>
      </div>
    </MobileSheet>
  );
}

export function MobilePageTools({
  open,
  onOpenChange,
  pageIndex,
  pageCount,
  disabled,
  onInsert,
  onDelete,
  onArrange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  pageIndex: number;
  pageCount: number;
  disabled: boolean;
  onInsert(position: "before" | "after"): void;
  onDelete(): void;
  onArrange(): void;
}) {
  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`第 ${pageIndex + 1} 页操作`}
    >
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className={action}
          disabled={disabled || pageCount >= 9}
          onClick={() => onInsert("before")}
        >
          在前面插入空白页
        </button>
        <button
          type="button"
          className={action}
          disabled={disabled || pageCount >= 9}
          onClick={() => onInsert("after")}
        >
          在后面插入空白页
        </button>
        <button
          type="button"
          className={action}
          disabled={disabled}
          onClick={onArrange}
        >
          整理这一页
        </button>
        <button
          type="button"
          className={`${action} border-t border-border text-destructive`}
          disabled={disabled || pageCount <= 1}
          onClick={onDelete}
        >
          删除这一页
        </button>
        {(pageCount >= 9 || pageCount <= 1) && (
          <p className="px-3 text-xs text-muted-foreground">
            {pageCount >= 9 ? "最多 9 页" : "至少保留一页"}
          </p>
        )}
      </div>
    </MobileSheet>
  );
}

export function MobileModuleTextEditor({
  text,
  disabled,
  error,
  onChange,
  onSelect,
  onSave,
  onCancel,
}: {
  text: string;
  disabled: boolean;
  error: string;
  onChange(text: string): void;
  onSelect?(cursor: number): void;
  onSave(): void;
  onCancel(): void;
}) {
  return (
    <MobileSheet
      open
      onOpenChange={open => {
        if (!open && !disabled) onSave();
      }}
      title="编辑文字"
    >
      <textarea
        autoFocus
        aria-label="文字模块内容"
        value={text}
        maxLength={12000}
        disabled={disabled}
        rows={6}
        onSelect={event => onSelect?.(event.currentTarget.selectionStart)}
        onChange={event => onChange(event.target.value)}
        className="w-full rounded border border-border bg-background p-3 text-base leading-relaxed"
        placeholder="写一句话…"
      />
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-3 pb-[env(safe-area-inset-bottom)]">
        <button
          type="button"
          className={action}
          disabled={disabled}
          onClick={onCancel}
        >
          取消改字
        </button>
        <button
          type="button"
          className={`${action} bg-primary text-primary-foreground`}
          disabled={disabled}
          onClick={onSave}
        >
          {disabled ? "正在保存…" : "完成"}
        </button>
      </div>
    </MobileSheet>
  );
}
