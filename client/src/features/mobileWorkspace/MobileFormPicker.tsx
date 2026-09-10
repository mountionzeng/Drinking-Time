/**
 * 「聊聊的外形」：五种外形任选，或跟随当天五行。
 *
 * 复用既有语义：外形就是五行主题，切换走 NayinContext 的 `setPreviewElement`，
 * 和电脑端顶栏那个选择器是同一套（含主题过渡）；「跟随当天五行」＝传 null。
 * 换外形只改外观，不动出生信息、真实日期、纳音计算、账号或内容。
 *
 * 预览图用设计稿那张水彩横排图。聊天里的聊聊仍是带 11 个表情的 SVG，
 * 因为水彩图只有静态形象——拿它进聊天，等回信时就没有脸可换了。
 */
import React from "react";

import { useNayin } from "@/features/nayin/NayinContext";
import { cn } from "@/lib/utils";
import { LIAOLIAO_FORMS, liaoliaoSpriteStyle } from "./liaoliaoForms";
import { MobileNotConnected, MobileSheet } from "./MobileSheet";

export function MobileFormPicker({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { element, previewElement, setPreviewElement } = useNayin();

  return (
    <MobileSheet
      open={open}
      title="聊聊的外形"
      description="五种外形，都是聊聊。换外形只改样子，不改出生信息、纳音计算和你的内容。"
      onOpenChange={onOpenChange}
    >
      <ul className="space-y-2">
        {LIAOLIAO_FORMS.map(form => {
          const selected = previewElement === form.element;
          return (
            <li key={form.element}>
              <button
                type="button"
                aria-pressed={selected}
                className={cn(
                  "flex min-h-16 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left",
                  selected
                    ? "border-primary bg-muted"
                    : "border-border/70 bg-transparent"
                )}
                onClick={() => setPreviewElement(form.element)}
              >
                <span
                  aria-hidden="true"
                  className="size-12 shrink-0"
                  style={liaoliaoSpriteStyle(form.element)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] text-foreground">
                    {form.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {selected
                      ? "当前选择"
                      : element === form.element
                        ? "今天的五行"
                        : "点击使用"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="mt-3 flex min-h-14 w-full items-center justify-between gap-4 border-t border-border/70 pt-3 text-left"
        onClick={() => setPreviewElement(null)}
      >
        <span>
          <span className="block text-[15px] text-foreground">
            跟随当天五行
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            恢复自动外形
          </span>
        </span>
        <span aria-hidden="true" className="text-muted-foreground">
          ›
        </span>
      </button>

      <div className="mt-4">
        <MobileNotConnected what="外形只在这台设备、这次打开期间生效。跨设备同步和长期保存还没有做，重新打开会回到当天五行。" />
      </div>
    </MobileSheet>
  );
}
