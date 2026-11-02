import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import type { ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { Check, ChevronRight } from "lucide-react";
import type {
  ImagePackModule,
  ModuleDocument,
  TextModule,
} from "./imagePackModules";

const itemClass =
  "relative flex h-8 cursor-default select-none items-center rounded-sm pl-7 pr-3 text-xs outline-none data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40";
const contentClass =
  "z-[90] min-w-40 rounded-sm border border-border bg-popover p-1 text-popover-foreground shadow-lg";

function KeyboardMenuTrigger({
  disabled,
  children,
}: {
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <ContextMenu.Trigger
      asChild
      disabled={disabled}
      aria-keyshortcuts="Shift+F10 ContextMenu"
      onKeyDown={event => {
        if (
          disabled ||
          event.target !== event.currentTarget ||
          !(
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          )
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + rect.width / 2,
            clientY: Math.max(0, rect.top) + Math.min(rect.height / 2, 24),
          })
        );
      }}
    >
      {children}
    </ContextMenu.Trigger>
  );
}

export function ModuleContextMenu({
  module,
  pages,
  pageIndex,
  disabled,
  children,
  onOpenChange,
  onChange,
  onDelete,
  onMove,
}: {
  module: ImagePackModule;
  pages: ModuleDocument["pages"];
  pageIndex: number;
  disabled: boolean;
  children: ReactNode;
  onOpenChange(open: boolean): void;
  onChange(change: Partial<Pick<TextModule, "emphasis" | "backdrop">>): void;
  onDelete(): void;
  onMove(pageIndex: number): void;
}) {
  const _ui = useDesktopUiText();
  return (
    <ContextMenu.Root onOpenChange={onOpenChange}>
      <KeyboardMenuTrigger disabled={disabled}>{children}</KeyboardMenuTrigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          aria-label={_ui("{0}模块设置", [module.kind === "text" ? _ui("文字") : _ui("图片")])}
          className={contentClass}
          onPointerDown={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}
        >
          {module.kind === "text" && (
            <>
              <ContextMenu.RadioGroup
                value={module.emphasis ?? "normal"}
                onValueChange={value =>
                  onChange({ emphasis: value as TextModule["emphasis"] })
                }
              >
                {[
                  ["normal", "正常"],
                  ["bright", "加粗提亮"],
                ].map(([value, label]) => (
                  <ContextMenu.RadioItem
                    key={value}
                    value={value}
                    className={itemClass}
                    disabled={disabled}
                  >
                    <ContextMenu.ItemIndicator className="absolute left-2">
                      <Check className="h-3 w-3" />
                    </ContextMenu.ItemIndicator>
                    {_ui(label)}
                  </ContextMenu.RadioItem>
                ))}
              </ContextMenu.RadioGroup>
              <ContextMenu.Separator className="my-1 h-px bg-border" />
              <ContextMenu.CheckboxItem
                className={itemClass}
                checked={module.backdrop ?? false}
                disabled={disabled}
                onCheckedChange={checked =>
                  onChange({ backdrop: checked === true })
                }
              >
                <ContextMenu.ItemIndicator className="absolute left-2">
                  <Check className="h-3 w-3" />
                </ContextMenu.ItemIndicator>
                {_ui("半透明底色")}</ContextMenu.CheckboxItem>
              <ContextMenu.Separator className="my-1 h-px bg-border" />
            </>
          )}
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={itemClass} disabled={disabled}>
              {_ui("移到其他页")}<ChevronRight className="ml-auto h-3 w-3" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent
                aria-label={_ui("选择目标页")}
                className={contentClass}
                onPointerDown={event => event.stopPropagation()}
                onKeyDown={event => event.stopPropagation()}
              >
                {pages.map((page, index) => (
                  <ContextMenu.Item
                    key={index}
                    className={itemClass}
                    disabled={disabled || index === pageIndex}
                    onSelect={() => onMove(index)}
                  >
                    {_ui("第 {0} 页", [index + 1])} · {page.label}
                    {index === pageIndex ? _ui("（当前页）") : ""}
                  </ContextMenu.Item>
                ))}
                <ContextMenu.Separator className="my-1 h-px bg-border" />
                <ContextMenu.Item
                  className={itemClass}
                  disabled={disabled || pages.length >= 9}
                  onSelect={() => onMove(pages.length)}
                >
                  {pages.length >= 9 ? _ui("已达 9 页上限") : _ui("移到新一页")}
                </ContextMenu.Item>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
          <ContextMenu.Separator className="my-1 h-px bg-border" />
          <ContextMenu.Item
            className={`${itemClass} text-destructive data-[highlighted]:bg-destructive/10`}
            disabled={disabled}
            onSelect={onDelete}
          >
            {_ui("删除")}{module.kind === "text" ? _ui("文字") : _ui("图片")}{_ui("模块")}</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function PageContextMenu({
  pageIndex,
  pageCount,
  disabled,
  children,
  onOpenChange,
  onInsert,
  onDelete,
}: {
  pageIndex: number;
  pageCount: number;
  disabled: boolean;
  children: ReactNode;
  onOpenChange(open: boolean): void;
  onInsert(position: "before" | "after"): void;
  onDelete(): void;
}) {
  const _ui = useDesktopUiText();
  return (
    <ContextMenu.Root onOpenChange={onOpenChange}>
      <KeyboardMenuTrigger disabled={disabled}>{children}</KeyboardMenuTrigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          aria-label={_ui("第 {0} 页操作", [pageIndex + 1])}
          className={contentClass}
          onPointerDown={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}
        >
          <ContextMenu.Label className="px-3 py-1 text-[11px] text-muted-foreground">
            {_ui("第")}{" "}{pageIndex + 1} {_ui("页")}</ContextMenu.Label>
          <ContextMenu.Item
            className={itemClass}
            disabled={disabled || pageCount >= 9}
            onSelect={() => onInsert("before")}
          >
            {_ui("在上方插入空白页")}</ContextMenu.Item>
          <ContextMenu.Item
            className={itemClass}
            disabled={disabled || pageCount >= 9}
            onSelect={() => onInsert("after")}
          >
            {_ui("在下方插入空白页")}</ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-border" />
          <ContextMenu.Item
            className={`${itemClass} text-destructive data-[highlighted]:bg-destructive/10`}
            disabled={disabled || pageCount <= 1}
            onSelect={onDelete}
          >
            {_ui("删除这一页")}</ContextMenu.Item>
          {(pageCount >= 9 || pageCount <= 1) && (
            <ContextMenu.Label className="px-3 py-1 text-[11px] text-muted-foreground">
              {pageCount >= 9 ? _ui("最多 9 页") : _ui("至少保留一页")}
            </ContextMenu.Label>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
