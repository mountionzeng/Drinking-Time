# Claude Design 任务：重做 Drinking Time 手机端视觉（只改皮，不改功能）

> 用法：把本文件全文贴给 Claude Design，**并附上你自己截的 2–4 张图**（见「视觉参考与防跑偏」一节）。

## 产品背景（决定气质）
Drinking Time（小酌）让普通人"像深夜跟朋友倒一杯、慢慢讲一件自己的小事"。手机端用户是**没有影视背景、只想回忆、不想操作**的普通人：打开手机跟"小酌"聊一段往事，聊着聊着画面就生成出来，他左划丢弃、右划收下，收下的图变成自己回忆的"故事版"。
**情绪基调：温暖、安静、亲密、不慌不忙，像一次深夜的私人谈话——绝不要科技感/企业感/工具感。**

## 任务
把手机端现有几个界面**重做视觉**，做到"美、克制、有情绪、移动原生"。**只做视觉，不动任何功能、流程、交互逻辑。**

## 必须遵守的设计系统（硬约束，不要另造审美）
手机端必须和桌面端**共用同一套设计系统**。直接使用下列 token，不要引入新色板/字体：

**整体气质**：Claude 风暖奶油浅色调，柔白卡片，大圆角。
- 背景 `--background`: `oklch(0.975 0.008 75)`（暖奶油）
- 文字 `--foreground`: `oklch(0.24 0.012 55)`（暖深灰）
- 卡片 `--card`: 纯白；`--muted`: `oklch(0.94 0.008 75)`；`--border`: 深色 10% 透明
- 圆角 `--radius`: 0.875rem
- 字体：正文 `Space Grotesk` + `PingFang SC`；等宽 `JetBrains Mono`

**纳音五行换肤（关键）**：强调色由"五行/饮品"动态决定。手机端所有强调色（按钮、高亮、选中、气泡）**必须用 `var(--nayin-accent)` 系列**，这样切主题时手机端跟着变色。
- 默认(可乐)：`--nayin-accent: oklch(0.62 0.14 45)`（焦糖）
- 金/啤酒=琥珀金、木/龙井=玉绿、水/椰子=柔青、火/大红袍=深红、土/咖啡=褐
- 配套：`--nayin-glow`（强调色 14% 光晕）、`--nayin-accent-bright`、`--panel-border`

**组件**：基于 shadcn/ui（项目已全量集成）。移动端优先用 `sheet`/`drawer`/`tabs`。

> 输出请直接用语义化 Tailwind 类（`bg-background`/`text-foreground`/`bg-card`/`text-muted-foreground`/`border-border`）+ `var(--nayin-accent)`，让设计**天生在系统里、天生响应换肤**。

## 要重做的界面（内容/功能保持不变，只让它变美）
1. **聊天页**：顶部小酌身份区（含五行饮品图标）；消息流（用户气泡 + 小酌气泡 + 对话流里内联出现的"生成图片卡"）；**底部输入条**：
   - 文字输入框
   - **麦克风语音按钮**，要设计三种状态：① idle（麦克风图标）② recording（录音中：停止图标 + 录音脉冲提示）③ transcribing（转写中：spinner）
   - 发送按钮
2. **生成图片卡**的状态：生成中（模糊草图→逐渐清晰）、生成完成、左划"丢弃"提示态、右划"收下"提示态。
3. **局部编辑态**：点图上某物体→高亮该区域→底部出现"描述要改成什么"的输入。
4. **故事版页**：竖向滚动，台词文字 + 每句台词下方对应的故事版图；可编辑（改台词、拖拽排序、删场景）。
5. **底部 Tab 栏**：聊天 ↔ 故事版，拇指可达。

## 移动端要求
- 拇指友好：主操作底部锚定、点按区 ≥ 44px。
- 图片卡尽量大、近全宽，让画面是主角。
- 等待="看着画面长出来"的仪式感（草图→清晰），别用生硬 loading。
- 手势可感知（左划/右划有视觉暗示），但**手势行为已实现，你只做它的视觉表达**。

## 视觉参考与防跑偏（务必照此对齐）
1. **附图（随本提示词一起给你的截图）**：
   - **桌面端截图** = 必须对齐的"好看"基准（暖奶油 + 纳音换肤 + 卡片质感）。手机端要和它**同一个设计语言**，只是移动布局。
   - **当前手机端截图** = 要修的"before"。问题是它用了写死的 amber/gray、脱离了设计系统、丑且不响应换肤。请**不要沿用它的配色**，用上面的 token 重做。
2. **五行饮品图标（5 个 logo）= 品牌核心资产，原样使用，禁止重画。**
   下面「附录」给出 5 个图标的 SVG 源码。请在设计里**直接嵌入这些 SVG（原封不动）**，不要自己画新的、不要改色改形。它们的颜色是手绘风的固有色（如啤酒琥珀、龙井玉绿、咖啡褐），强调色用 `var(--nayin-accent)`，两者并存。

## 硬约束
- **只改视觉**：保留全部现有功能、流程、手势、交互行为；不增删功能、不改信息架构（仍是"聊天页 + 故事版页 + 底部 tab"两页）。
- **不另造色板/字体**：强调色走 `var(--nayin-accent)`，中性色走语义 token；不得出现 `amber-700`/`gray-400` 这类硬编码色。
- **5 个图标原样复用**（见附录），不得重画。
- **不碰桌面端。** 浅色为主。

## 交付
为上述 5 类界面分别产出高保真设计；最好直接输出**用上述 token 的 React/TSX**（每屏一个组件，图标处直接内嵌附录的 SVG），让工程实现 100% 还原、不靠肉眼对像素。

---

## 附录：五个五行饮品图标 SVG 源码（原样使用，勿重画）

**金 / 啤酒（metal）**
```svg
<svg viewBox="0 0 90 100" fill="none" stroke="#7A5B1F" stroke-linecap="round" stroke-linejoin="round">
  <path d="M22,20 C25,12 35,9 42,14 C46,8 56,8 60,15 C68,13 73,20 70,28 L22,30 Z" fill="#F6E29C" stroke-width="1.4"/>
  <path d="M28,18 c2,-3 6,-3 7,1" stroke-width="1" opacity=".6"/>
  <path d="M50,14 c2,-2 5,-1 5,2" stroke-width="1" opacity=".6"/>
  <path d="M22,30 L24,82 C24,86 26,89 30,89 L62,89 C66,89 68,86 68,82 L70,30" fill="#F2D86A" stroke-width="1.6"/>
  <path d="M70,42 C82,44 82,68 70,72" stroke-width="1.4" fill="none"/>
  <path d="M70,48 C76,50 76,66 70,68" stroke-width="0.9" fill="none" opacity=".5"/>
  <circle cx="34" cy="48" r="2" fill="#fff7d2" stroke-width=".8"/>
  <circle cx="44" cy="58" r="1.4" fill="#fff7d2" stroke-width=".8"/>
  <circle cx="56" cy="44" r="1.6" fill="#fff7d2" stroke-width=".8"/>
  <circle cx="40" cy="70" r="1.2" fill="#fff7d2" stroke-width=".7"/>
  <circle cx="52" cy="68" r="1" fill="#fff7d2" stroke-width=".7"/>
  <circle cx="46" cy="6" r="1.6" stroke-width=".9" opacity=".7"/>
  <circle cx="56" cy="3" r="1.1" stroke-width=".7" opacity=".5"/>
  <circle cx="38" cy="2" r="1" stroke-width=".7" opacity=".5"/>
  <path d="M30,40 L32,75" stroke-width=".8" opacity=".5"/>
</svg>
```

**木 / 龙井茶碗（wood）**
```svg
<svg viewBox="0 0 90 100" fill="none" stroke="#33532B" stroke-linecap="round" stroke-linejoin="round">
  <path d="M30,18 c-3,-6 4,-8 1,-14" stroke-width="1.1" opacity=".7"/>
  <path d="M44,14 c-3,-5 3,-7 0,-12" stroke-width="1.1" opacity=".7"/>
  <path d="M58,18 c-3,-6 4,-8 1,-14" stroke-width="1.1" opacity=".7"/>
  <ellipse cx="45" cy="38" rx="28" ry="6" fill="#fff" stroke-width="1.5"/>
  <path d="M17,38 C18,60 30,80 45,80 C60,80 72,60 73,38" fill="#E5EFD3" stroke-width="1.6"/>
  <ellipse cx="45" cy="84" rx="34" ry="5" fill="#fff" stroke-width="1.4"/>
  <path d="M11,84 C13,90 30,93 45,93 C60,93 77,90 79,84" stroke-width="1.4" fill="none"/>
  <ellipse cx="45" cy="38" rx="24" ry="4" fill="#A9C66B" stroke-width=".8" opacity=".7"/>
  <path d="M38,38 q3,-3 7,0 q-3,3 -7,0" fill="#5D8A4A" stroke-width=".8"/>
  <path d="M50,40 q2,-2 5,0 q-2,2 -5,0" fill="#5D8A4A" stroke-width=".7"/>
  <path d="M73,40 q8,-4 6,-12 q-3,-3 -6,2" stroke-width="1.2" fill="none"/>
  <ellipse cx="80" cy="29" rx="3" ry="1.6" fill="#A9C66B" stroke-width=".8" transform="rotate(-30 80 29)"/>
</svg>
```

**水 / 椰子（water）**
```svg
<svg viewBox="0 0 90 100" fill="none" stroke="#4A7A8A" stroke-linecap="round" stroke-linejoin="round">
  <path d="M22,52 C22,30 38,20 50,22 C62,24 72,38 70,58 C68,78 50,86 38,82 C26,78 22,68 22,52 Z" fill="#D8E8F0" stroke-width="1.6"/>
  <path d="M30,40 c4,4 8,4 14,0" stroke-width=".6" opacity=".5"/>
  <path d="M30,52 c6,6 14,6 22,0" stroke-width=".6" opacity=".5"/>
  <path d="M32,64 c4,3 12,3 18,0" stroke-width=".6" opacity=".5"/>
  <path d="M40,30 c4,2 10,2 14,-2" stroke-width=".6" opacity=".5"/>
  <path d="M52,8 L60,30" stroke-width="1.6"/>
  <path d="M50,12 L58,32" stroke-width="1.6"/>
  <path d="M51,11 L59,31" stroke="#EAF2F6" stroke-width="1"/>
  <path d="M55,4 c-2,3 -2,6 1,6 c3,0 3,-3 1,-6 z" fill="#9AC5D6" stroke-width=".8"/>
  <path d="M16,84 q6,-6 14,-2 q4,-6 12,-3 q5,-5 14,0 q6,-3 12,2" stroke-width="1.4" fill="none"/>
  <path d="M22,90 q4,-3 8,-1" stroke-width="1" opacity=".6"/>
  <path d="M58,92 q4,-3 8,0" stroke-width="1" opacity=".6"/>
  <circle cx="14" cy="78" r="1" fill="#9AC5D6" stroke-width=".5"/>
  <circle cx="78" cy="80" r="1.2" fill="#9AC5D6" stroke-width=".5"/>
  <circle cx="82" cy="72" r=".8" fill="#9AC5D6" stroke-width=".5"/>
</svg>
```

**火 / 大红袍茶壶（fire）**
```svg
<svg viewBox="0 0 90 100" fill="none" stroke="#6B2A22" stroke-linecap="round" stroke-linejoin="round">
  <path d="M28,16 c-4,-7 4,-9 0,-16" stroke-width="1.2" opacity=".7"/>
  <path d="M42,12 c-4,-7 4,-9 0,-16" stroke-width="1.2" opacity=".7"/>
  <path d="M56,16 c-4,-7 4,-9 0,-16" stroke-width="1.2" opacity=".7"/>
  <circle cx="42" cy="22" r="3" fill="#C0473A" stroke-width="1.2"/>
  <path d="M42,25 L42,30" stroke-width="1.2"/>
  <path d="M22,30 C22,26 30,24 42,24 C54,24 62,26 62,30 Z" fill="#E08775" stroke-width="1.5"/>
  <path d="M16,32 C14,52 18,72 32,80 C46,86 60,84 70,72 C78,62 78,46 74,32 Z" fill="#D6604A" stroke-width="1.6"/>
  <path d="M14,40 C6,38 2,46 6,52 C10,52 14,50 16,46 Z" fill="#D6604A" stroke-width="1.4"/>
  <path d="M74,38 C84,40 86,58 76,62" stroke-width="1.5" fill="none"/>
  <path d="M28,58 C40,62 56,62 66,58" stroke-width="0.9" opacity=".5"/>
  <circle cx="34" cy="46" r="1.2" fill="#FAE5DD" stroke-width=".5" opacity=".8"/>
  <circle cx="50" cy="42" r="1" fill="#FAE5DD" stroke-width=".5" opacity=".7"/>
  <path d="M44,90 c-2,-4 2,-6 0,-10 c4,4 6,2 4,8 c-1,4 -3,5 -4,2 z" fill="#E89373" stroke-width=".9" opacity=".7"/>
</svg>
```

**土 / 咖啡（earth）**
```svg
<svg viewBox="0 0 90 100" fill="none" stroke="#4A2E1B" stroke-linecap="round" stroke-linejoin="round">
  <path d="M34,16 c-3,-6 3,-8 0,-14" stroke-width="1.1" opacity=".6"/>
  <path d="M50,12 c-3,-6 3,-8 0,-14" stroke-width="1.1" opacity=".6"/>
  <ellipse cx="45" cy="86" rx="34" ry="5" fill="#D9C8AC" stroke-width="1.4"/>
  <path d="M11,86 C13,92 30,95 45,95 C60,95 77,92 79,86" stroke-width="1.4"/>
  <path d="M20,32 L18,76 C18,82 24,86 30,86 L60,86 C66,86 72,82 72,76 L70,32 Z" fill="#B58968" stroke-width="1.7"/>
  <path d="M22,46 L68,46" stroke-width=".7" opacity=".4"/>
  <path d="M22,68 L68,68" stroke-width=".7" opacity=".4"/>
  <ellipse cx="45" cy="32" rx="25" ry="4" fill="#D9C8AC" stroke-width="1.4"/>
  <ellipse cx="45" cy="32" rx="22" ry="3" fill="#3E2516" stroke-width=".6"/>
  <path d="M30,32 c4,-2 8,2 14,0 c5,-2 9,1 12,0" stroke="#A87858" stroke-width=".8" fill="none" opacity=".8"/>
  <path d="M70,42 C84,46 86,68 70,72" stroke-width="1.6" fill="none"/>
  <path d="M70,48 C78,50 80,64 70,66" stroke-width=".8" opacity=".5" fill="none"/>
  <ellipse cx="20" cy="92" rx="3" ry="1.6" fill="#4A2E1B" stroke-width=".6" transform="rotate(-20 20 92)"/>
  <path d="M17,92 q3,-1 6,0" stroke="#F0E6D6" stroke-width=".6"/>
</svg>
```

> 源码出处：`client/src/features/nayin/views/WuxingDrinkIcon.tsx`（如有更新以代码为准）。
