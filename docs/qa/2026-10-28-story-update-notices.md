# 故事更新提醒排查

- 只读检查Chrome本地页：VC们正文下显示“未保存 · 草稿保留在本机”；IAB旧页也有独立未保存内容，而且仍显示旧前端的新增章节/历史版本控件。两边均未被本次保存或覆盖。仅主仓3000一个服务。
- 根因：尚未提交的浏览器草稿不会被服务端轮询读取；保存入口在文章末尾，不明显。旧标签还未加载检测修复。候选/收件箱缺少定时更新。
- 改动：保存状态置顶；同故事新版本显式提示查看并接收；候选和收件箱15秒及聚焦/重连检查，显示来稿提醒；收件箱提示是账户级，不冒称全部属于当前故事。
- 接收保护：再次核对被比较版本，版本变化时拒绝接收；独立草稿不清除。当前版本尚未归档时不误调用历史版本恢复接口。
- 浏览器：测试标签刷新后全局故事选择回到了真实面试故事，因此仅只读核对置顶未同步提示，没有写入真实故事。尚未完成真实两个浏览器保存/接收及朋友发回全链路。
- 未部署，未调用AI。

验证结果：pnpm check通过；pnpm verify:draft-safety 65项通过；ChapterWorkspace 7项通过（包含候选/来稿提示及轮询配置）；feature:validate 72卡通过。新回归覆盖干净稿也需提示、明确接收、比较后并发更新拒绝、独立草稿阻止覆盖。截图 outputs/story-sync-status-20261028.png 位于协调工作目录。

## Follow-up: autosave and link-only sharing
- Removed manual save panel, chapter selector, recipient picker. Debounced text save preserves concurrent typing; explicit comparison for stale drafts and server CAS remain.
- Real Chrome draft (18 blocks) retained as version 9; IAB detected v9 and adopted it. History showed old v8/7/6 in descending order. No draft was silently discarded.
- Generated a local claim link without a recipient; not sent to another person. Localhost links are only for local testing.
- Heading formatting remains browser-local. Existing multiple-chapter data was not merged or deleted; this story has one chapter. Not deployed.

## 格式持久化与自动保存机制（后续修复）
- 之前格式仅存在浏览器的问题已修复：writingStyle 与正文一起存入服务器章节 JSON，无新增迁移。独立格式修改、版本恢复、草稿基准检查均包含格式。
- 自动保存等待 1.5 秒；保留请求期间的新输入；本机缓存失败不阻止服务器保存；online 事件重试离线稿，仍保留 CAS 检查。后台保存带 autosave 标记，不挤占十版历史。
- 样式按语义字段比较，避免客户端与校验后 JSON 键序不同而误判未保存、循环保存。
- 实测：Chrome 原有折叠标题自动保存为 v10；新 IAB 页读到 Spark Lab/锦秋/奇绩。Chrome 仅展开 Spark Lab，自动保存 v11；IAB 显示 v11 更新通知，查看并明确接收后展现相同展开状态及子模块。随后在 Chrome 折回并自动保存，最终 IAB 重载后为原折叠状态。
- 未编辑正文，未发送外部链接，未调用 AI，未部署。微信包样式元数据传输尚未包含在本轮；真实浏览器断网未模拟，重连用事件回归验证。
- 最终检查：10个测试文件87项通过（含保存安全门禁用例），pnpm check通过，feature:validate 72卡通过，git diff --check通过。截图：协调目录 outputs/book-format-autosave-20261028.png。
