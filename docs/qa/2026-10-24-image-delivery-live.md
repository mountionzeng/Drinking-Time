# 2026-10-24 正式站图片生成真实验收

## 确认的阻塞点

1. 原提示词模型 gpt-5.4-nano-2026-03-17 在 Next 返回429，在302返回400 api_error。分别用 max_tokens 和 max_completion_tokens 做最小虚构请求仍400，不能归因于某一个 token 字段。gpt-4.1-mini 在两通道均实际200、stop并返回正确短文，正式环境 IMAGE_PROMPT_302_MODEL 改用此模型；图片模型未变。
2. 网页真实生成 POST 被 nginx 默认60秒代理等待截断，出现 HTML/JSON 解析错误。只给 /api/trpc/publishingDraft.generateCover 增加660秒读超时，覆盖现有600秒MJ等待；nginx -t 通过并平滑reload。
3. 同一MJ任务已SUCCESS/100%，返回 file.302.ai 图片，但生产DNS解析异常，取图超时。对应 file.302ai.cn CNAME 指向302的阿里云OSS，同路径HTTPS HEAD成功，image/webp。国内API模式下仅将确切 file.302.ai 的HTTPS文件域名改为国内别名，保留路径和查询参数；其他来源不变。

## 验证与恢复边界

测试故事112「配图验收 · 雨后书店」为网页新建的独立虚构文稿，非用户原作。用户授权本轮最多1算力。只提交一次图片任务 1792849794968528，后续恢复沿用任务编号。未主动执行额外付费质检。

先复现国内文件地址缺失的失败测试，再修复；4文件159项测试通过，涵盖已有任务恢复与不重新POST、国际网关及第三方图片URL保持原状。

配置备份在生产 /root/drinking-time-image-preparation-20261024/：before.env、metadata.json、nginx.before.conf。仅改提示词模型环境项和上述单一路由超时；不改密钥、数据库、登录权限或SSL验证。最终上线与网页结果追加于文末。

国内文件服务只读HEAD检查出现一次瞬时ENOTFOUND；补充已有图片下载GET的建连失败单次重试，不重试生成POST。失败测试复现后，imageGen和publishingDraft共152项通过。

## 真实网页最终验收通过

与「继续整理整合版」会话按用户授权统一发布，保留章节功能。线上后端SHA256 `c8b574a62c2fc2f03ded73364b39008dc86b5b9da4e50c405949b07508a826cf` 含9ebd1a86和24464c42。旧完整构建检测到线上已更新时主动停止，未覆盖章节版本。

正式站 https://www.drinkingtime.top/editing 刷新恢复同一任务后，故事112生成状态completed，一轮4资产。点击文章末尾「配图」，图片面板显示4 existing images；四张真实img均complete=true、naturalWidth=928、naturalHeight=1232。截图 `/tmp/publishing-images-live-20261024.png`。未购买第二轮。账号余额由3.68降至3.42，减少0.26算力，低于用户批准的1算力；另有两次30-token最小供应商诊断（其中302报告0.0000228美元）用于验证模型连通性，没有用户正文。

图片已经交付，截图时后台质检仍在进行，不宣称图像质量或文字检测已经通过。主干代码与QA已保存，功能账本校验通过。后续实际速度受供应商影响，不保证每次即时完成。
