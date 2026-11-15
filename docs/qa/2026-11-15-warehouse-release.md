# 2026-11-15 仓库多选发布

用户明确授权“合 main、push、部署”。隔离源码基于 main fc8cb7d3；与生产 render-chat-failure-20261115 权威源码的运行代码完全一致。只整合仓库修复、多选连续视频和必要的排序、源视频悬浮/帧引用、聊天历史定位依赖。未带入尚未验收的森林/云层改色实现。

## 发布前检查

- 独立发布目录 /tmp/dt-warehouse-release-20261115/src，不启动服务器，不复制业务数据或密钥。
- 主仓只有3000服务。所有未提交工作按内容哈希保护；使用独立暂存索引提交经过验证的文件，保留其余工作区内容。
- 43项Drizzle迁移基线、103卡功能账本、类型检查通过。
- 完整回归初跑7950项通过、23项失败、76项跳过。修复本次新增服务直接依赖db兼容门面的规范问题及双语占位符；隔离目录补git快照后旧git-grep门禁通过。最终相关7文件73项通过。
- 其余20项失败均在未修改main复现：storyAgent旧路由6项、visualEditUnderstanding报价8项、章节交付3项、仓库内部状态边界1项、无JWT测试环境2项。本轮不将完整测试宣称为全绿。
- MySQL一次性受限账号先验证正式库查询被拒绝；73项通过、2项旧信箱测试失败、1项跳过，两项失败已在未修改main的独立MySQL环境原样复现。临时账号已删除，本地trigger设置已恢复。不修改生产schema或数据。
- 最终构建通过，包含77项草稿保护检查，仅既有bundle体积/第三方注释提示。
- 主线程逐项审查归属/报价指纹/持久幂等/全部预占/未知回执/取消与故事切换/候选不采用。冻结视频供应商、计费恢复、首尾帧与小程序文件未改。
- 真实3000选图、顺序、免费报价、取消和原图片编辑已验收，见 warehouse-multiselect QA；未购买真实生成，不据此声称供应商成片质量已通过。

## 部署记录

- 代码提交：`9c2bc0323f81dc89c84f00321901d64d318f59fd`，已在main并push到origin/main。
- 生产发布：`warehouse-sequence-20261115`；manifest：`/opt/Drinking-Time/dist.release-warehouse-sequence-20261115.json`；回滚备份：`/opt/Drinking-Time/backups/warehouse-sequence-20261115`。
- 仅替换5个变化编译产物，保留旧hash资源；部署后及公网复验共288个线上文件SHA一致。新前端`index-B1Khzkag.js`，app-release版本`509863b4-dd2b-48c5-84f5-b713411b4413`，HTML与4个公网资源内容一致。
- `/healthz`正常，`/readyz`为ready/mysql/required，新warehouseVideoSequence.status匿名返回401。HTTP `/m`实际为301并精确跳转同域HTTPS；初次脚本误断言308导致检查失败，已纠正校验，不是线上跳转故障。
- `.env`、package.json、pnpm-lock.yaml哈希未变；未修改数据库、nginx或证书。本地仍只有主仓3000服务。
- 正式站浏览器：故事“满城”第04镜按图片23→22选择，弹窗顺序正确；免费报价对非方图明确提示画幅不支持、不静默裁切。已取消多选、收起仓库并关闭本轮临时tab，没有购买、采用或修改作品。
- 正式站截图：`/Users/yuandai/Documents/Codex/2026-11-15/warehouse-multiselect/production-warehouse.png`和`production-quote-limit.png`。
- 发布源码、补丁、测试/部署日志与产物位于`/tmp/dt-warehouse-release-20261115`。主仓原111个未提交文件逐一内容哈希保护；未验收森林/云层等工作保持原样。没有新建git工作树或dev服务。
- 连续视频功能仍为partial：真实供应商生成、接缝与运动质量未付费验收；此前既有测试失败已基线复现，不能称全量测试全绿。
