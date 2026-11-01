# 书内图片聊天编辑（本地）

用户要求：点击书内图进入聊天改图，可圈选局部，也可变成原位短视频。

## 实现

- 原聊天底部切换改图片、圈选局部、变成小视频；统一输入框接受指令，显式费用确认后生成。
- 局部沿用 segmentRegion + signed quote + inpaint 的真实蒙版链路，不以提示词冒充蒙版。目标绑定已保存的章节与模块。
- 短视频复用视频任务、轮询与请求去重，以章节/模块独立身份记录；不借用故事镜头1的提示或运动策略。
- 候选必须点击采用；保留模块ID、位置、裁切、缩放及其他段落。采用调用非autosave保存，保留旧稿；原图继续作为视频poster及历史来源。
- 账号、story epoch、模块、原URL改变后拒绝错误采用；提交前先保存并再次检查选择。
- 内嵌视频为video controls，避免嵌套在button内。跨端存储沿用正文图片语法附加video元数据。

## 验证

- 媒体回归10文件63项通过（所有权/目标变化、报价变化、视频请求复用与镜头上下文隔离、媒体序列化和inline video渲染等）。
- pnpm verify:draft-safety：7文件69项通过。
- pnpm check、pnpm migration:verify、pnpm feature:validate。
- IAB独立标签22：VC们已有图片仅做只读选择；点击后出现编辑面板，拖框后确认选区启用，短视频输入发送后显示1.76算力确认，没有调用付费生成，没有改变正文。
- 修正面板与小鸟输入区重叠；图片面板限高且可滚动。

## 边界

- 未实际付费生成图片/蒙版/短视频，供应商质量与完成后的浏览器采用尚未实测；服务层使用模拟供应商验证。
- 仅处理本故事素材库中已登记图片；导入而尚未入库的图提示不可生成。
- 整图沿用旧generateForMobile，无持久请求令牌；发出后清除确认按钮，异常不自动重试。局部和视频有持久回执。
- 新增0038枚举迁移和快照，未运行生产数据库迁移，未提交或部署。

## Follow-up: freehand subject selection

- Rectangle removed from book image UI. Multiple freehand strokes accumulate; positive samples identify subject intent, not a polygon or brush mask. Redraw clears selection and quote.
- Semantic vision returns a complete object/part silhouette and anchor. Require anchor inside contour and >=60% sampled marks within it; no clipping to stroke bounds. Unsupported/ambiguous responses fail closed. Legacy lasso clients keep original path.
- Added tests for collinear marks/full-object mask area, incorrect contour, unavailable provider and unknown submission; segmentation suite 22 tests.
- Real IAB test: two strokes over illustrated hair, one recognition request. Provider openai-next/qwen3-vl-plus timed out at 30033ms. No contour returned, no automatic retry, no image modification. Friendly Chinese uncertainty message added. Real recognition quality remains unverified.

## Live acceptance follow-up (2026-10-29, not release-ready)

User authorized small real compute tests. All mutations were confined to the fictional `按钮验收 1003（虚构）` story; source image 1892 remains unchanged in book module 8. No production deploy or schema migration.

### Bugs fixed from real calls

- Whole-image remix was quoted as GPT Image but dispatched through FLUX. Explicit `preferStructuralEdit` now uses the quoted provider; router regression checks it.
- Vision's lossless input PNG grew to 1,940,879 bytes. Its JPEG analysis copy is 150,447 bytes; original edit pixels and mask dimensions remain intact. A real semantic contour returned in 11.65 seconds.
- Multi-sample coordinate-only requests sometimes returned malformed, repetitive contours. Scribble analysis now supplies the untouched image plus an annotated analysis copy, asks for a compact contour and JSON mode. The annotated copy is never used as an editing source. Browser tab 24 successfully recognized the umbrella after drawing, displayed its mask, obtained a signed quote, and submitted a masked edit.
- Different scribbles with the same centroid no longer share cached segmentation results.
- 302 async poll returned HTTP 200 with upstream status 401 and an error JSON string inside `data`; preserve the safe error code/reason instead of reporting only 401. The existing task was queried without resubmission.
- Removed the GPT edit `response_format=url` query, which the official documentation describes as DALL-E-only. This did NOT resolve the provider failure; do not claim it did.
- MJ video defaults now match current official `/mj-turbo/submit/video` and `/mj-turbo/task/{taskId}/fetch`, including MJ authentication. Preserve explicit legacy overrides. Quotes use the documented 0.6 PTC per task (four 5-second candidates), not the unrelated transition-duration estimate; low/high motion cost the same. Duration field compatibility retained.
- Busy image UI no longer invites another prompt; quote/generation no longer misleadingly labels itself as subject recognition.

### Actual external results / blockers

- Whole image: task `eb0080fc30ee4eec96ed5579d0005746` and corrected request `1ffb780bb1fe4e5b8fb8fc2b521afec7` both definitively returned upstream `401 / -10003` (parameter rejected). A minimal synchronous request using the documented model/image/prompt/size/quality fields also returned the same error in 6.15s. No generated candidate. Do not keep retrying paid submissions.
- Masked image: real browser request with scoped mask + signed quote reached the image edit provider and returned HTTP 401. Original retained, no candidate adopted.
- Video: original and documented turbo routes returned HTTP 404, no task ID. Empty-body route diagnostics against both documented domains also returned 404 HTML (GPTProto frontend), not a job response. No successful video generated or adopted.
- Remote mask backup/storage returns 503 / -10008 (no available models). Local durable mask remains usable; this does not demonstrate cloud availability.
- Vision: successful service-level contours and one browser-level contour, but earlier malformed model replies were rejected. This is not evidence of general segmentation quality.
- Adoption, real candidate playback, history after adoption and reopening remain UNVERIFIED because no provider image/video candidate completed. Whole-image legacy endpoint still lacks a durable idempotency/resume record; do not represent all operations as complete.

### Verification

- 8 adapter/segmentation/video/target suites: 146 tests passed (after annotated input + JSON changes).
- Prior live-pass routing/vision/guard suites: 93 tests passed.
- Typecheck, feature ledger and final narrow regression results are recorded below after completion.

Official contracts checked: https://doc.302.ai/288853817e0.md and https://doc.302.ai/329178975e0.md .

Final checks: `pnpm check`, `pnpm feature:validate` (72 cards), `pnpm migration:verify` (39 migrations) and `git diff --check` passed. Final image error adapter/quote regression: 93 tests passed. No generated asset was adopted; end-to-end acceptance remains blocked, not complete.

## 12:42 feedback follow-up — nested editing and visible selection

- Top-level image actions are now 改图片 / 变成小视频. 整张修改 / 只改局部 are nested under 改图片; freehand subject recognition belongs to the latter.
- Mask PNG already includes alpha. Removed the additional 40% CSS opacity (which previously reduced the effective tint to ~14%); display the real cyan mask with a subtle outline. 看原图 / 显示选区 toggles were clicked successfully. Failed/missing mask preview prevents paid submission.
- Composer no longer shrinks over the editing buttons. Compact scrollable image panel keeps the input visible; mouse clicks on quotation and generation now reach their intended actions.
- GPT Image 1.5 edit still failed with a minimal documented request. A distinct GPT Image 2 low-quality probe succeeded (real PNG inspected). Switch the shared structural/masked edit profile to GPT Image 2 and its documented 30 PTC/M output-token price; quote version advances to v2. Ordinary text-to-image model configuration is unchanged.
- Synchronous high-quality operation 4 lost its connection without a receipt. Preserve unknown status and do not resubmit it. Masked edits now request async receipts and reuse the existing durable operation mechanism; resumed output must be composited with the original pixels and stored mask. Tests cover immediate response, async completion and receipt-only recovery, preserving pixels outside the mask.
- Browser operation 5 uses a different blue-umbrella instruction in fictional story 按钮验收 1003（虚构）, source 1892 / module 8. Receipt ca4aa3693aa94c7ba9c686bc5b46e9d2 was persisted before polling. First contour was rejected for inconsistency; one additional stroke produced a visible cyan umbrella silhouette. Boundary quality remains approximate and requires user inspection before generation.
- Current checks: typecheck, 142 tests in 8 targeted suites, and production build passed. The test's final outcome is recorded below.

### Final real masked-image result

- Operation 5 succeeded at 13:09:59 local time, candidate image 1987 (`/api/images/1793250599384-tco0ty.png`), parent 1892. One async POST, persisted receipt, completed in ~152 seconds.
- Decoded original/result/mask are all 1024x1024 RGBA. Exactly 997,897 protected (mask alpha 255) pixels compared; **zero changed**. 50,678 pixels inside editable region changed. A small top red rim remains because it is outside the identified mask: do not claim perfect whole-object segmentation.
- Clicked 用这一版 · 放回原位置, waited for 已保存, reloaded and selected module 8: blue image remains in original position; all seven text modules remain. Version list shows current 3 and previous 2.
- Screenshots in coordination outputs: `book-media-blue-candidate-20261029.png`, `book-media-blue-reopened-20261029.png`.
- Video remains unverified/404 as above; this task does not claim video readiness. No production deployment.

## Lower-cost transparent patches (next conversation, 2026-10-29)

User requested a cheaper local edit based on a small transparent replacement that inherits the original art, and cleanup of abandoned implementations. Implemented the new path in the existing signed quote/operation flow; no new RPC endpoint or database migration.

- `localImagePatch.ts` validates the full canonical mask, finds its pixel bounds, includes 25% nearby context, and prepares a 512px crop + <=512px whole-image style reference. Letterboxing and inverse coordinates are deterministic for asynchronous recovery.
- GPT Image 2 low renders the context crop (provider minimum output remains 1024 square). The original crop and whole artwork carry medium/brushwork/palette/lighting/perspective; explicit instructions prevent returning the overview or a collage. We do not claim original seed or unknown generation parameters can be recovered.
- Use the same confirmed mask to extract a small RGBA PNG locally and composite it back. No extra paid background-removal call, no changes outside the selection, no automatic adoption. The app saves the composite candidate linked to its parent/mask, with the original version retained. The transparent buffer is transient, avoiding orphan library assets.
- New quote/profile `local-image-patch-v1`: estimate ¥0.27 / **0.54 compute**, versus previous high-quality estimate ¥1.43 / 2.86 compute (81.1% lower). This is a conservative token estimate; segmentation is separate. Unrelated whole-image/reference/cover prices retain their old profile.
- Synchronous response and async recovery share `storeGptEditResult`: only the final composite is stored; raw provider crop is not saved as a misleading full-frame candidate.
- Removed unused `inpaintImage` / FAL flux-fill implementation and stale tests/mocks after checking repo-wide call sites. Active generic mask/reference paths remain, including legacy full-frame recovery; no blanket deletion of shared image code.

### Real paid acceptance

- Fictional story 1202, book module 8, source1987 -> candidate1988. Operation6 / receipt `bcf6daf93f8b4ae0b2813a6d0e14da83`, created13:40:02, completed13:40:58 (~57s). One POST. Blue umbrella fabric -> warm yellow; watercolor texture, ribs and shaded lighting remain visually coherent in this example. No claim of universal subject-boundary quality.
- Provider returned quality low; input2229 (image2048/text181), output196. At documented rates8/5/30 PTC per million and the existing PTC/CNY conversion, equivalent cost is ¥0.155945 / **0.31189 compute**, excluding segmentation. This is a calculation from reported usage, not a verified vendor invoice or a promised fixed price.
- Transparent patch bounds: left456/top230/width568/height420 in 1024² source. Protected992653 pixels compared; **zero changes**. Extracted patch is RGBA with transparent exterior. Reconstructed composite exactly equals saved candidate pixels.
- Real UI displayed0.54 quote, generated candidate, accepted back in module8, and reached 已保存. Reopen/previous-version checks are recorded below.
- Artifacts: coordination `outputs/local-patch-quote-20261029.png`, `local-patch-candidate-20261029.png`, `local-patch-transparent-20261029.png`, `local-patch-composite-20261029.png`, `local-patch-verification-20261029.json`.
- Automated: 5 targeted suites112 tests pass; typecheck and build pass. Tests cover nonsquare/offcentre crop mapping, exact protected bytes, transparent patch, invalid masks, low-quality multipart with both style references, immediate/async/resume result equivalence, one final stored asset and no resubmit on recovery. Adjacent results below. No deployment.

Final acceptance: reloaded the browser after adoption; module8 still shows the yellow result and 已保存. Version list shows current4 plus previous3 (blue) and2 (red). Screenshots `local-patch-history-20261029.png` and `local-patch-reopened-20261029.png` retained. Adjacent regression: 82 tests across6 suites now pass (64 storyAgent cases rerun after replacing stale, pre-existing ¥1.49 / 2.98 fixtures with the current whole-image quote; the first failed run left unused mock responses queued and caused two downstream failures). Numeric cost contracts remain independently asserted in shared/imageRenderCost.test.ts. Typecheck/build/feature ledger/diff whitespace checks passed. Only the fictional story was changed; no user article edits or deployment.
