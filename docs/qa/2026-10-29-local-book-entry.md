# 本地书稿显示旧版本：2026-10-29

原因：重新执行 pnpm dev 时未携带此前仅存在于进程环境的 CHAPTER_PACKAGE_ENABLED=true，PublishingDraftWorkspace 回退到旧平台文稿编辑器。旧编辑器的“已保存”不是书稿当前版本，两个入口显示不同权威数据。

修复：在主仓被忽略的 .env 中持久配置 CHAPTER_PACKAGE_ENABLED=true，tsx 重启后生效；不修改生产开关，不修改任何文章或版本记录。变更前备份 local-persist.json 和 edit-snapshots-local.json 到 .webdev/manual-backups-*-book-view。

验证：环境检查仅主仓 3000 一个服务。Story 1209 的书稿 1 为“VC们”，当前版本12，2026-10-28 22:47保存，正文603字；历史11/10/9等保留。独立IAB标签实测看到 VC们、已保存、当前版本12、各版本的打开对比按钮。旧标签有本机未保存草稿，保留未刷新。截图位于协调工作区 outputs/book-history-restored-20261029.png。

后续本机启动使用持久配置，不再依赖临时 shell 开关。此次为运行配置修复，无业务源码变更或生产部署。
