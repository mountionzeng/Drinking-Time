# 图文全文与选图复制验收

日期：2026-10-16。主仓端口 3000，未部署。

## 入口与行为

- 排版工具栏和手机成品预览使用同一个「复制…」面板：复制全文文字、复制当前图片、选择图片。
- 全文来自当前排版模块，按页码和模块顺序包含修改、新增与跨页文字，保留段落与 Unicode，不包含已删除模块，不改写原文。
- 选图默认勾选当前页，可全选、取消全选或选择任意页；复制/下载始终按页码顺序处理，空选择禁用操作。
- 单张复制使用原 PNG。多张通过明确的「复制为长图」合为一个剪贴板图片项，不声称能一次粘贴多张独立图片；独立图片可「下载所选图片」。长图宽 900px，每页高 1200px，最多 9 页；原独立 PNG 不降分辨率。
- 图片在打开时准备最新快照；正文/来源失效时关闭面板，关闭会取消未完成的渲染/合成，错误不会显示复制成功。剪贴板请求在点击时发起，图像 Blob 使用 Promise 传入，避免等待合成导致部分浏览器失去用户手势。
- 图片复制不可用时保留全文入口，明确提示下载。无模型请求、后端正文变更或对外分享。

## 自动化

6 文件 84 项测试通过，包括新增加的 10 项复制测试：全文顺序/段落/重复文字、单张原 Blob、离散选页合成顺序、9 页尺寸、空选/超限、解码与编码失败、取消清理、同步发起单个剪贴板项、无剪贴板能力的降级。

```sh
pnpm exec vitest run \
  client/src/features/publishingAlbum/imagePackCopy.test.ts \
  client/src/features/publishingAlbum/imagePackModules.test.ts \
  client/src/features/publishingAlbum/imagePackModuleRenderer.test.ts \
  client/src/features/publishingAlbum/PublishingImagePack.test.tsx \
  client/src/features/publishingAlbum/MobileModuleTools.test.tsx \
  client/src/features/mobileWorkspace/MobileImageStudio.test.tsx
```

`pnpm check`、`pnpm build`、`pnpm feature:validate`（61 张功能卡）和 `git diff --check` 均通过。构建保留既有大包体提示。

## 浏览器

- 实际 `/editing` 的四页用户排版显示完整复制面板和选图缩略图。用户操作过程中未修改作品或尝试还原页数；后续复制数据验收使用独立临时样例。
- 样例使用同一 `ImagePackCopyDialog`，三张纯色 PNG 和包含换行/表情的测试文字，不读写故事。
- 真实点击复制全文后，通过样例的剪贴板读取入口读取并逐字比较，结果「文字一致」。
- 勾选第 1、3 张并复制长图后，从真实剪贴板读取 `image/png`，尺寸为 900×2400；肉眼确认上半为第 1 张、下半为第 3 张，中间未加入第 2 张。
- 复制当前图片后，从真实剪贴板读取 PNG，尺寸仍为 1800×2400。
- 全选显示 3 张；取消全选后，复制和下载均禁用。
- 临时样例源文件和页签验收后删除；保留用户正在使用的实际工作区。

截图：

- `/Users/yuandai/.codex/visualizations/2026/10/15/01a1402b-f1cb-72b2-a8d7-9746e3c11c30/image-pack-copy-options.png`
- `/Users/yuandai/.codex/visualizations/2026/10/15/01a1402b-f1cb-72b2-a8d7-9746e3c11c30/copy-clipboard-verification.png`

## 验证边界

内置浏览器自动化工具的虚拟剪贴板与网页剪贴板独立，因此没有用工具的空读数判断产品失败；实际数据通过临时样例中的原生 Clipboard API 读取并显示验证。未向第三方应用发送内容；微信、Safari、iOS/Android 真机粘贴与多文件下载仍受目标应用和权限限制，待验收。
