# 书内图乐复用 · 2026-11-02

本地主仓 3000，未提交、未推送、未部署；没有新增付费图片、音乐、视频调用。

## 实现

- `bookVideoSource` 读取当前保存书稿，只收书内引用，不扫描采用整仓候选。正文和旧布局图片按同故事资产验证、去重引用；缺失/拒绝的图片不冒充可用。
- 音乐、有声书标记从旁白正文中剥离。仅书内同故事 ready 音乐列入复用清单；有声书不作为配乐。旧布局变化也进入书稿来源指纹。
- 清单进入创作意图和分镜上下文；方案记录保存音乐名称/身份/长度。`useBookMusic=false` 支持用户明确不用原配乐的讨论结果。
- 确认后通过原 `timelineAudioEditing` 唯一写入者、相同CAS/持久回执写音乐，缺失时间轴使用既有 Story 投影初始化，保留画面、字幕和其他扩展。
- 多段音乐按书内顺序顺接、裁到成片长度，初始增益0.25。已有配乐（含静音选择）保留；去重标记防止后续方案复活被删音乐。
- 音乐写入失败不会标记方案完成，已经确认的表格保留，重试继续完成，不重复镜头。图乐复用不调用生成供应商。
- 方案详情显示清单与缺失提示；历史未盘点方案不显示虚假的“0段音乐”。进入时间轴主动失效素材查询缓存。

## 验证

`pnpm exec vitest run server/services/bookVideoSource.test.ts server/services/bookVideoCreation.test.ts server/services/timelineAudioEditing.test.ts server/services/timelineSubtitleEditing.test.ts server/services/publishingVideoStoryboardPersistence.test.ts server/services/publishingVideoStoryboard.test.ts client/src/features/bookVideo/BookVideoChat.test.tsx client/src/features/bookVideo/confirmBookVideo.test.ts`

8 文件、75 项通过，日志 `/tmp/book-media-verified.log`。包含真实本地持久化的确认/音轨写入、保留原资产与视觉投影、失败后恢复、同故事归属、并发重试、删后不复活、人工配乐保护、图片旧布局去重和拒绝候选。

最初类型检查通过；最终共享工作区检查期间并行分镜MJ会话新增 `storyboardImageTask` 的 Result/generationType 类型错误，连带 image remix/creation editor 类型报错。不属于本轮改动，未接管其占用文件；不能视为当前全库门禁通过。`git diff --check` 通过。

浏览器实际打开既有虚构纸船V3方案，参数/两镜头仍在；开发热更新短暂加载空状态，刷新后原书稿与V1/V2/V3恢复。没有修改该故事、调用付费生成或伪造其音乐清单。

## 尚未覆盖

- 没有实测带真实音乐的整片导出试听；音轨复用由持久化集成测试验证，不将其写成完整视频验收。
- 不自动循环短音乐，不自动调整已有人工配乐适应新版本长度；仓库未插入素材、旧独立封面和原视频不在此轮自动复用范围。
- 原书裁切样式未烧录为新图，沿用原始图片资产；需要不同景别时仍为补镜参考，不伪称已有画面符合。

## 最终复验

- 素材索引刷新改为后台进行，补一条慢查询不阻塞导航测试；UI 8项通过，累计本轮相关76项（75+新增1）。
- 并行分镜类型错误随后已由对应会话修正；最终 `pnpm check` 退出0，日志 `/tmp/book-media-final-types.log`。77卡 `pnpm feature:validate`通过。
- 本机热更新稳定后，实点“进入视频表格”成功，保留两镜头和V1/V2/V3。截图 `/tmp/book-video-media-reuse/timeline.png`。这张截图是入口/历史回归，不是带音乐成片验收。
