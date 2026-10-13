# 聊聊（写不下去时）交接文档

**日期**: 2026-10-12 15:50  
**当前状态（接手更新）**: 前端与两端接入已完成，本地验证通过，尚未提交/部署。

## 接手结果（2026-10-12）

实际接手时按钮文件不存在、导航也尚未修改；现已补齐。用户在本会话明确确认底部只保留「故事／我」。

- 新增 `WritingCompanionButton.tsx`：点击后挂载、逐句对话、可编辑段落、显式插入、网络错误及未同步轮次恢复。
- 接入桌面发布正文、手机当前正文和手机独立文字稿编辑弹窗。
- 插入前检查正文及 Story/版本/修订范围，变化时保留结果供复制。
- 正常关闭后重新开始；有未同步回答时例外，先恢复原轮次和原正文上下文，避免丢话或重复生成。
- requestHash 协议保持；写作上下文保存在本机恢复记录，重试不从当前编辑器重新取。
- 定向测试20文件160项与类型检查通过，浏览器验证手机真实开场/关闭/重开与桌面入口。详细证据及真机缺口见 [QA](../qa/2026-10-12-writing-companion.md)。

以下保留最初交接说明作为历史记录；其中“尚未完成”和文件位置以以上结果及当前代码为准。

## 后续续作：桌面选区改写（2026-10-12）

用户补充希望在电脑端编辑正文时选中一段，再由小忆围绕这段内容对话并改写。本地已在已有小忆入口上接好：选区成为唯一改写范围，提交前显示对应状态，确认后只替换所选文字，前后正文逐字保留；没有选区时继续原有停笔处插入。选区状态随未同步轮次恢复，旧正文/版本/选区变化时失败关闭。选区模式的开场问题即时生成，省去一次模型等待；后续多轮速度仍取决于供应商。

`pnpm check`、44 项伴写/服务/恢复测试、66 项桌面发布和手机编辑/对话回归通过，功能账本已更新。当前 3000 浏览器中的故事没有可编辑正文，本轮未触发浏览器改稿；未提交、推送或部署。验证记录见 [QA](../qa/2026-10-12-writing-companion.md)。

---

## 已完成的工作

### 1. 后端核心逻辑（✅ 完成并测试通过）

**文件**: `server/services/writingCompanion.ts` (323 行)

三个函数实现了完整的「帮写」流程：

1. **`openWritingCompanion(input)`** — 点开时读正文、判断写到哪一步、只问一个问题
2. **`replyAsWritingCompanion(input)`** — 用户每回答一句，接住并追问
3. **`composeWritingParagraph(input)`** — 把对话整理成一段可以放回光标处的草稿

**提示词设计原则**（已写在代码里）：
- 每次只问一个问题，贴着他写下的具体的人、事、物
- 不问「你当时什么感受」这种空泛问题
- 如实接住：开心就是开心，平淡就是平淡，不往伤感、矛盾上带
- 不编造他没说过的事实、对白和动机
- 说话像朋友发消息：短、口语，不用文学腔

**测试**: `server/services/writingCompanion.test.ts` (311 行，18 个测试全部通过)

### 2. 后端路由集成（✅ 完成）

**改动**:
- `server/services/storyConversation.ts`: 5 处编辑，让手机整轮机制支持 `writingContext` 参数
- `server/routers/promptLineage.ts`: 4 处编辑，新增两个 mutation：
  - `storyConversation.writingCompanionOpen` — 点开时的第一个问题（不落库）
  - `storyConversation.writingCompanionCompose` — 整理成一段（不写正文）
- 用户回答走现有的 `storyConversation.generateMobileTurn` + `appendMobileTurn`，带上 `writingContext` 就会路由到帮写

**测试**: 32 个测试全部通过（包括幂等、恢复、权限检查）

### 3. 前端工具函数（✅ 完成）

**文件**: `client/src/features/writingCompanion/writingCompanionText.ts` + `.test.ts`

- `insertParagraphAtCursor(draft, cursor, paragraph)` — 把整理好的段落插回停笔处
- `writingCompanionErrorMessage(error)` — 把网络错误转成用户能懂的话
- 8 个测试全部通过

### 4. 导航栏调整（✅ 完成）

按用户 2026-10-12 的决定，手机底部只留「故事」和「我」两个入口，聊聊不再是一页，而是正文旁的小忆图标。

**改动**:
- `client/src/features/mobileWorkspace/MobileNavBar.tsx`
- `client/src/features/mobileWorkspace/MobileWorkspace.tsx`
- `client/src/features/mobileWorkspace/MobileWorkspace.test.tsx`

---

## 需要继续完成的工作

### 1. 前端浮层组件（⚠️ 写到一半）

**文件**: `client/src/features/writingCompanion/WritingCompanionButton.tsx` (已写外壳，缺内容面板)

**已有**:
- 按钮：小忆图标，点击后打开浮层
- Popover 外壳
- 类型定义：`WritingCompanionSnapshot`, `Exchange`

**还需要写** `WritingCompanionPanel` 组件：

```typescript
function WritingCompanionPanel({
  snapshot,
  resolveStoryId,
  onInsert,
  onClose,
}: {
  snapshot: WritingCompanionSnapshot;
  resolveStoryId: () => number | Promise<number>;
  onInsert: (paragraph: string, cursor: number) => void;
  onClose: () => void;
}) {
  // 状态机：idle -> opening -> (asking <-> user typing)* -> composing -> drafted
  const [step, setStep] = useState<WritingCompanionStep>({ kind: "idle" });
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [storyId, setStoryId] = useState<number | null>(null);

  // 1. 挂载时调用 writingCompanionOpen，拿到第一个问题
  // 2. 用户输入后调用 generateMobileTurn + appendMobileTurn（带 writingContext）
  // 3. 点「整理成一段」时调用 writingCompanionCompose
  // 4. 点「放进正文」时调用 onInsert(paragraph, snapshot.cursor)

  // UI:
  // - 顶部：小忆头像 + 关闭按钮
  // - 中间：对话气泡（系统问题靠左，用户回答靠右）
  // - 底部：输入框 + 发送按钮 / 整理按钮 / 放进正文按钮
}
```

**参考现有组件**:
- `client/src/features/mobileWorkspace/MobileChatView.tsx` — 对话气泡样式
- `client/src/features/mobileWorkspace/useMobileConversation.ts` — 手机整轮的调用方式
- `client/src/features/mobileWorkspace/MobileDocumentView.tsx` — 输入框 + 按钮布局

### 2. 集成到两个宿主页面

#### 网页正文编辑器

**文件**: `client/src/features/publishingDraft/PublishingDraftWorkspace.tsx`

**位置**: 第 257 行附近，`<textarea id="publishing-body">` 下方或旁边

**调用**:
```tsx
<WritingCompanionButton
  resolveStoryId={async () => {
    await ensureActiveStoryPersisted();
    return activeStoryId!;
  }}
  getSnapshot={() => ({
    draft: editorContent.body,
    cursor: document.getElementById("publishing-body")?.selectionStart ?? 0,
  })}
  onInsert={(paragraph, cursor) => {
    const result = insertParagraphAtCursor(
      editorContent.body,
      cursor,
      paragraph
    );
    replaceContent({ ...editorContent, body: result.body });
    // 焦点回到正文，光标落在插入的段落后面
    setTimeout(() => {
      const textarea = document.getElementById("publishing-body") as HTMLTextAreaElement;
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(result.cursor, result.cursor);
      }
    }, 50);
  }}
/>
```

**注意**: `PublishingDraftWorkspace.test.tsx` 用的是 `renderToStaticMarkup`（服务端渲染），它看不到 tRPC Provider，所以 `WritingCompanionButton` 的浮层只能在点开后才挂载（现在的设计已经是这样）。

#### 手机正文编辑

**文件**: `client/src/features/mobileWorkspace/MobileDocumentView.tsx`

**位置**: 第 180 行附近，输入框旁边或右上角

**调用**:
```tsx
<WritingCompanionButton
  resolveStoryId={() => activeStoryId ?? Promise.reject("无故事")}
  getSnapshot={() => ({
    draft: body,
    cursor: cursorPosition,
  })}
  onInsert={(paragraph, cursor) => {
    const result = insertParagraphAtCursor(body, cursor, paragraph);
    onBodyChange(result.body);
    setCursorPosition(result.cursor);
  }}
  size={28}
  className="absolute right-2 top-2"
/>
```

### 3. 样式调整

**可能需要的 CSS**（加到 `client/src/index.css`）:

```css
/* 聊聊浮层内的对话气泡 */
.writing-companion-exchange {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.writing-companion-exchange[data-role="assistant"] {
  justify-content: flex-start;
}

.writing-companion-exchange[data-role="user"] {
  justify-content: flex-end;
}

.writing-companion-bubble {
  max-width: 75%;
  padding: 0.625rem 0.875rem;
  border-radius: 1rem;
  font-size: 0.9375rem;
  line-height: 1.5;
}

.writing-companion-bubble[data-role="assistant"] {
  background: var(--nayin-surface-dim, #f5f5f5);
  color: var(--foreground);
  border-bottom-left-radius: 0.25rem;
}

.writing-companion-bubble[data-role="user"] {
  background: var(--nayin-accent, #c4612f);
  color: white;
  border-bottom-right-radius: 0.25rem;
}
```

---

## 技术要点

### 后端幂等与恢复

手机整轮机制已经支持：
- `clientTurnId` + `requestHash` 确保同一轮对话只生成一次
- `generateMobileTurn` 先算、再落库，算好的回复可以反复取
- `appendMobileTurn` 幂等追加，重试不会重复写

`writingContext` **不参与** `requestHash` 计算（见 `shared/promptLineage.ts` 的 `computeStoryConversationTurnRequestHash`），因为它是生成上下文，不是对话内容本身。

### 前端状态机

```
idle
  ↓ (挂载)
opening (调用 writingCompanionOpen)
  ↓ (拿到第一个问题)
asking (显示系统问题 + 输入框)
  ↓ (用户输入 + 点发送)
[调用 generateMobileTurn + appendMobileTurn，带 writingContext]
  ↓ (拿到回复)
asking (追加到 exchanges，继续显示)
  ↓ (用户点「整理成一段」)
composing (调用 writingCompanionCompose)
  ↓ (拿到草稿 paragraph)
drafted (显示草稿 + 「放进正文」按钮)
  ↓ (用户点「放进正文」)
[调用 onInsert，关闭浮层]
```

如果 `composeWritingParagraph` 返回 `{ paragraph: null, ask: "..." }`，说明内容还不够，把 `ask` 当作系统的追问，回到 asking 状态。

### tRPC 调用示例

```typescript
const openMut = trpc.storyConversation.writingCompanionOpen.useMutation();
const composeMut = trpc.storyConversation.writingCompanionCompose.useMutation();

// 点开时
useEffect(() => {
  if (!storyId) return;
  setStep({ kind: "opening" });
  openMut.mutate(
    { storyId, draft: snapshot.draft, cursor: snapshot.cursor },
    {
      onSuccess: (data) => {
        setExchanges([{ role: "assistant", content: data.question }]);
        setStep({ kind: "asking" });
      },
      onError: (error) => {
        setStep({ kind: "error", message: writingCompanionErrorMessage(error) });
      },
    }
  );
}, [storyId]);

// 用户发送后
// （参考 useMobileConversation.ts 的 runMobileConversationTurn）

// 整理成一段
composeMut.mutate(
  { storyId, ...snapshot, exchanges },
  {
    onSuccess: (data) => {
      if (data.paragraph) {
        setStep({ kind: "drafted", paragraph: data.paragraph });
      } else if (data.ask) {
        setExchanges(prev => [...prev, { role: "assistant", content: data.ask }]);
        setStep({ kind: "asking" });
      }
    },
  }
);
```

---

## 测试清单

### 后端（✅ 已通过）

- [x] `writingCompanion.test.ts` 18 个单元测试
- [x] `storyConversation.mobile.test.ts` 幂等与恢复
- [x] `routers.storyConversation.test.ts` 权限检查

### 前端（⚠️ 待完成）

- [ ] `WritingCompanionButton.test.tsx` — 按钮点击、浮层打开关闭
- [ ] 网页正文里点击、插入段落、光标位置正确
- [ ] 手机正文里点击、插入段落、键盘不被挡住
- [ ] 多轮对话、中途关闭浮层、重新打开（新 session）
- [ ] 网络错误、算力不足、权限错误的错误提示

---

## 注意事项

1. **不要改 `requestHash` 计算**：`writingContext` 已经被排除在外，同一轮对话带不带正文都是同一个身份。

2. **不要在按钮渲染时就调用接口**：浮层点开后才挂载 `WritingCompanionPanel`，才开始调用 tRPC。

3. **草稿插入要用 `insertParagraphAtCursor`**：它处理了首尾空行、光标位置计算，直接字符串拼接会出错。

4. **记忆仓库会收录用户回答**：用户在聊聊里说的每一句都走 `appendMobileStoryConversationTurn` 落库，`chatMemoryWarehouse` 会看到；开场问题和最后的草稿不落库，不会进记忆。

5. **浮层关闭后状态清空**：每次点开都是新 session（`key: Date.now()`），之前的对话不保留。

---

## 相关文件清单

**后端（已完成）**:
- `server/services/writingCompanion.ts` (新增 323 行)
- `server/services/writingCompanion.test.ts` (新增 311 行)
- `server/services/storyConversation.ts` (5 处编辑)
- `server/routers/promptLineage.ts` (4 处编辑)
- `shared/promptLineage.ts` (不需要改，`writingContext` 已被排除)

**前端（部分完成）**:
- `client/src/features/writingCompanion/writingCompanionText.ts` (新增 ✅)
- `client/src/features/writingCompanion/writingCompanionText.test.ts` (新增 ✅)
- `client/src/features/writingCompanion/WritingCompanionButton.tsx` (外壳 ⚠️)
- `client/src/features/mobileWorkspace/MobileNavBar.tsx` (已改 ✅)
- `client/src/features/mobileWorkspace/MobileWorkspace.tsx` (已改 ✅)
- `client/src/features/mobileWorkspace/MobileWorkspace.test.tsx` (已改 ✅)

**待集成**:
- `client/src/features/publishingDraft/PublishingDraftWorkspace.tsx` (待加按钮)
- `client/src/features/mobileWorkspace/MobileDocumentView.tsx` (待加按钮)

---

## 下一步

1. 完成 `WritingCompanionPanel` 组件（对话气泡 + 输入框 + 状态机）
2. 集成到网页正文和手机正文
3. 写前端测试
4. 真机测试：点开、对话、插入、关闭、重新打开

所有后端逻辑和测试都已经通过，前端只需要连上这些接口就能跑起来。
