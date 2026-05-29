# Codex 任务：手机端 UI 改成和设计稿「一模一样」（视觉像素级保真）

> 整件交给你一次性做：① 五行颜色按精确值更新；② 手机各屏按设计稿**逐屏转写**。做完我会逐屏验收。

## 设计稿（唯一视觉真相源）
`/Users/yuandai/Downloads/Mobile Redesign _standalone_.html`
- 文件 6.5MB，因为内嵌了 base64 字体和图片。**真正的 markup + CSS 很小**——分块读，**忽略 base64 字体/图片大块**，只提取 `<style>` 里的 CSS 规则和各屏的 DOM 结构。

## 目标与边界（重要）
- 目标：手机端**视觉/布局**和设计稿**一模一样**（颜色、间距、圆角、阴影、排版、每个组件形态都照搬）。
- 边界：设计稿是**静态 mockup**（假数据、占位图、无真实交互）。所以"一模一样"指**视觉层**——内容仍用项目里的**真实数据**（真实对话、真实生成图），交互**接现有逻辑**。不要把 mockup 的假数据/占位图也搬上去。

## 方法（保真的关键：转写，不是重画）
1. **提取**设计稿 `<style>` 的精确 CSS 规则（排除 @font-face base64），放进项目（新建一个 mobile 专用 css，或并进 index.css 的 mobile 段）。
2. 对每一屏，把设计稿的 **DOM 结构原样搬**进对应 React 组件，保留它的 class / 内联样式。
3. 只做两件"改写"：把假数据换成真实数据绑定；把按钮/手势接到**现有的 handler**（从 `MobileChatContext` 来）。
4. **不要"看着设计稿凭理解重画"**——那样必然漂移。要逐像素对着搬。

## 五行颜色（精确值，更新 `client/src/index.css`）
把每个 `[data-nayin]` 块的 accent / accent-bright / glow 改成下列**精确值**，token 名不变；base 浅色 token（`--background/--foreground/--card/--muted/--radius`）已经和设计稿一致，**别动**。

| 元素 | `--nayin-accent` | `--nayin-accent-bright` | `--nayin-glow` |
|------|------------------|--------------------------|----------------|
| 默认(可乐) `:root` | `oklch(0.62 0.14 45)`（不变）| `oklch(0.70 0.18 45)` | `oklch(0.62 0.14 45 / 14%)` |
| `[data-nayin="metal"]` 金 | `oklch(0.72 0.13 85)` | `oklch(0.80 0.16 85)` | `oklch(0.72 0.13 85 / 14%)` |
| `[data-nayin="wood"]` 木 | `oklch(0.58 0.10 150)` | `oklch(0.68 0.13 150)` | `oklch(0.58 0.10 150 / 14%)` |
| `[data-nayin="water"]` 水 | `oklch(0.58 0.08 220)` | `oklch(0.66 0.11 220)` | `oklch(0.58 0.08 220 / 14%)` |
| `[data-nayin="fire"]` 火 | `oklch(0.55 0.15 30)` | `oklch(0.62 0.18 30)` | `oklch(0.55 0.15 30 / 14%)` |
| `[data-nayin="earth"]` 土 | `oklch(0.48 0.08 55)` | `oklch(0.56 0.11 55)` | `oklch(0.48 0.08 55 / 14%)` |

> 其余每元素 token（`--nayin-accent-dim / surface / surface-dim / text-subtle / border / bg-gradient`）：把色相对齐到上面的新 accent 色相即可，亮度/彩度可沿用现有比例。`--panel-border` 如果要按设计稿改成"按元素着色"，先确认不会破坏桌面端边框——拿不准就保持现状。

## 屏幕 → 组件映射（逐屏对齐）
| 设计稿屏 | 改这个文件 |
|---------|-----------|
| 聊天页（顶栏 + 消息流 + 底部输入条含**麦克风按钮三态**）| `client/src/features/mobileChat/views/MobileChatPage.tsx` + `MobileChatMessages.tsx` |
| 生成图片卡（生成中/完成/左划丢弃/右划收下）| `views/ImageCard.tsx` |
| 局部编辑态（长按→高亮→描述修改）| `views/MobileImageEdit.tsx` |
| 故事版页（垂直滚动场景）| `views/MobileStoryboard.tsx` + `StoryboardScene.tsx` |
| 底部 Tab 栏（聊天/故事版）| `views/MobileTabBar.tsx` |

## 硬约束
- **只改视觉**：`MobileChatContext.tsx` 的状态/逻辑**不要动**；保留全部功能、手势、数据流。
- 强调色一律走 `var(--nayin-accent)` 系列，**不得写死** `amber/gray` 之类 hex（图标固有色除外）。
- 保留我已加的：聊天输入条的**麦克风按钮三态**、`MobilePage.tsx` 的**首次进入跳 `/m/welcome`** 逻辑、`/m` 与 `/m/storyboard` 路由、`MobileWelcomePage`。
- **桌面端**：手机组件是独立的，但 `index.css` 的 nayin 颜色是全局的——颜色改动桌面会跟着变，这是预期的"一套设计系统",不算破坏。

## 完成后请提供 + 自检
1. `npm run check`（tsc）通过。
2. 逐屏对照设计稿，确认视觉一致。
3. 功能零回归：聊天发送、图片卡左右划、局部编辑、故事版拖拽/编辑/删除、底部 tab、首次进入跳欢迎页。
4. 切换五行主题，确认手机端颜色跟着变。
5. 列出改动清单（每个文件改了什么）+ 哪些你测了、哪些没法测（真机/手势我来验）。
