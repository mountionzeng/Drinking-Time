# 2026-10-24 配图准备限流修复

## 线上证据

21:30 的配图准备失败记录与 inference.text 的 released / actualCostMinor=0 对应；图片任务编号为空。服务器记录 Next 的 gpt-5.4-nano-2026-03-17 返回 HTTP 429 / upstream_rate_limit。此处 replaySafe=false 也禁止了明确未受理请求使用已有 302 备用通道，用户仅得到笼统报错。

## 修复与边界

新增显式 retryRejected，仅在结构允许重放、供应商明确未受理且错误可重试时沿既有候选链继续；图片提示词编译开启此选项。未知受理的断线、408、5xx 仍停止，不改模型、余额、正文、图片任务或费用确认。限流提示明确说明文字服务繁忙、尚未提交出图。

## 验证

先复现 429 未使用备用的失败测试，再通过修复。定向覆盖编排、提示词准备、发布路由和推理计费；模拟供应商响应，无真实付费请求。上线后只做健康与文件摘要验证；供应商实时可用性和真实图片交付仍待用户明确生成验证。

独立发布快照验证：5 个测试文件、142 项通过；TypeScript、67 张功能账本校验、后端构建通过。

## 上线记录

修复提交 `5168fa67a1cc115224c1f4b544e508b5b343f622` 已推送 main 并上线。仅替换 dist/index.js，后端 SHA256 `030372c0ffd2e7dead262e97f194c81ad31d1fca71f2ab5b6f468da7af4f3280`；127 个前端及配置文件摘要保持一致。PM2 重启后 ready（MySQL / authentication required）。备份 `/opt/Drinking-Time/dist.index.bak-20261024-image-rejection-5168fa67.js`；回滚仅恢复此后端并重启 PM2，无数据库变更。未自动重放历史任务或提交付费生成。证据目录 `/tmp/dt-image-rejection-esrfrwzo`。
