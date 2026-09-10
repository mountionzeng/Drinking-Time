/**
 * 「存入故事」：把**聊聊整理出的正文**预览后存进目标故事的可编辑版本。
 *
 * 当前状态：**入口在，能力未完成**。
 *
 * 缺的是「整理稿」这个来源。核查结果：
 *
 * - 仓库里真正的「整理成正文」是 `publishingDraft.generate`——它读这个故事的对话，
 *   生成平台文字稿。但它有两个性质决定了不能在点「存入故事」时顺手调：
 *   一是**真实模型调用**（`runJsonAgent`），二是它**直接写进该故事自己的正文**，
 *   不是「返回一段可搬运的文本」。
 * - 因此没有「只产出、不落库」的整理稿来源。
 *
 * 上一版把**聊聊最近一条回复**当整理稿，是错的：那是对话原话，不是整理稿，
 * 存进正文会从叙述突然掉进对话。已经移除，不再有这个默认值。
 *
 * 在拿到用户对整理方式（触发、范围、费用）的裁定之前，这里**不保存、不生成、
 * 不改存原话**，只说明缺什么。`composeArchivedBody` 保留并继续由测试锁着，
 * 整理稿来源一旦确定即可直接接上。
 */
import React from "react";

import { MobileNotConnected, MobileSheet } from "./MobileSheet";

export type ArchiveMode = "append" | "replace";

/**
 * 追加就是「原文 + 空行 + 新段」，替换就是新段本身。
 *
 * 单独抽出来是为了能直接测：真机上试不出「原文有没有被留住」，但这里可以。
 */
export function composeArchivedBody(
  currentBody: string,
  addition: string,
  mode: ArchiveMode
): string {
  const next = addition.trim();
  if (mode === "replace") return next;
  const base = currentBody.replace(/\s+$/, "");
  return base ? `${base}\n\n${next}` : next;
}

export function MobileArchiveSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <MobileSheet
      open={open}
      title="存入故事"
      description="把聊聊整理出的正文，存进故事的可编辑版本。"
      onOpenChange={onOpenChange}
    >
      <MobileNotConnected what="这个功能还没有完成——缺的是「整理稿」本身。" />

      <p className="mt-4 text-sm leading-7 text-foreground">
        存进故事的应该是<strong className="font-medium">聊聊整理出的正文</strong>，
        不是聊天原话。现在还没有可用的整理稿，所以这里不会保存任何东西。
      </p>

      <div className="mt-4 text-[11px] tracking-[0.07em] text-muted-foreground">
        为什么还不能存
      </div>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-7 text-muted-foreground">
        <li>
          仓库里真正的「整理成正文」是发布稿生成，它读这个故事的对话来写。
        </li>
        <li>
          但它是一次<strong className="font-medium text-foreground">真实的模型调用</strong>，
          而且会<strong className="font-medium text-foreground">直接写进这个故事自己的正文</strong>，
          不会单独交出一段可以搬到别处的文字。
        </li>
        <li>
          所以「先整理、再预览、再存到你选的那个版本」这条路，需要先定下整理怎么触发。
        </li>
      </ul>

      <p className="mt-4 text-sm leading-7 text-muted-foreground">
        在你定下来之前，这里不会偷偷生成，也不会拿最近一条回复冒充整理稿。
      </p>
    </MobileSheet>
  );
}
