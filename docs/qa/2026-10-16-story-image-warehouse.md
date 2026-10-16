# 故事生成图片完整入仓

## 修复

生成的封面、正文插图和花纹底图本来已写入当前故事的 generatedImages，但使用 publishing_cover 分类，既不属于镜头图片，也不属于 unassignedImages，因此仓库漏显。

新增独立 warehouseImages 投影，由当前故事的完整图片资产构成，不以当前发布版本、是否采用、镜头绑定或用户曾拒绝候选作为归档过滤条件；不存在的本地文件不展示。人物/宠物等 visual_asset 标准视图保持原资产分类，镜头与未分配投影不变。仓库按图片 ID 去重并合并镜头关联，旧客户端数据回退 unassignedImages。

电脑和手机生成/恢复流程结束后，按 storyId 使仓库与图片查询失效，新候选无需先用于镜头即可入仓。没有迁移业务数据，也没有重复生成或采用任何图片。

## 验证

- 4 文件 75 项测试通过：storyMaterials、imageAssets、MobileImageStudio、PublishingDraftWorkspace。新增测试创建12张同故事封面类候选、失配镜头图片、标准视图、其他故事与其他账号图片，验证完整归档、拒绝状态保留、分类与归属隔离；原封面不得进入镜头/未分配集合的断言保留。
- 手机测试断言生成结束按当前 storyId 刷新素材查询。
- pnpm check、pnpm build、git diff --check、pnpm feature:validate。
- 主仓 localhost:3000 真实工作区打开「视频 → 素材仓库」：图片12、资产1，候选缩略图可见。只打开界面，无生成、绑定或正文写入。临时页已关闭，截图 /tmp/story-image-warehouse.png。

## 范围

本次包含已存入故事的 AI 生成图片素材和历史候选，不包含本机临时上传或带文字的排版成品。是否归档排版成品已向用户询问，未默认创建每次实时排版的永久快照。历史文件实际丢失不在此次修复范围。未调用付费生成、未部署。
