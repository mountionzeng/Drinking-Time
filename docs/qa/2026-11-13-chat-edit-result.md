# 原对话改图状态与实际新图展示

日期：2026-11-13。主仓 main / localhost:3000/editing。未提交、未部署。

## 用户可见结果

Launch Video / story1217 / 第03镜镜内6.33秒 / 原帧2109：在原输入框再次发送“云还是需要白一点”，报价后由用户明确批准0.54算力，随后仍在原对话输入“确认生成云层”。302 / GPT Image 2只提交一次，生成候选2110，已显示原图和新图对比，刷新后自动定位到对比。没有采用到剪辑线。

- requestId：47927bfb-7f9d-47e9-b27f-a089a15c59b6
- providerTaskId：cc7036637c9548d7b16a8972a5309cd4
- review：226c023a-2798-49eb-bcd0-8458210b0ec0，R3报价 → R4候选
- 尺寸：960×960（供应商及保存结果匹配）
- 原图2109 → 新图2110，isCurrent=false
- 独立像素核验：changedPixels=363424，maskPixels=363500，outsideChangedPixels=0
- 允许范围内近白像素（RGB各通道>210且最大通道差<32）：38 → 68590；这是颜色变化证据，不代替用户美术确认。
- 目视：云高光明显更白，阴影仍有蓝粉紫色；森林与飞机保留。云纹理的重复度仍需用户判断，未宣称美术全部验收。

## 代码

ChatFrameRegionReview显示当前对象、帧时间、原图编号、用户原话和真实任务状态；未生成的范围图明确标注。根据同故事/同镜头/同原图/同请求回执区分等待确认、生成中、未知、失败、已生成；旧报价过期明确提示。

生成候选排在尚未完成的其他范围图之前，当前目标优先；chatMessageScroll对新图直接定位到比较区，避免被前一项森林范围遮住。其他范围仍可向下查看，未新增操作按钮。

界面助手改为在同一分句匹配导航动词与目的地，修复“我先查看这一帧的范围，暂不生成图片或视频”被查看.*视频误分流。相同原句已在3000重测返回本地范围提示，billingOperations保持242，没有重试上轮未知请求242。

## 验证

- 共享路由、界面桥、状态/比较区、范围聊天、滚动、恢复及云购买保护测试：85项通过；随后补1项跨故事隔离，组件15项复查通过（总覆盖86项）。
- TypeScript、构建、功能账本及diff检查通过（最终日志见证据目录）。
- 真实页面：报价可读、生成中状态、等待仍可输入、结果进入聊天、新图优先、刷新后对比保持。
- 前后storyTimelines、videoTakes、storyAudioAssets、抽帧操作完全相同，剪辑修订仍28；仅新增1张图2110，只有1个新生成请求。
- 本机不限额模式未新增统一billingOperations扣费记录；0.54是本次授权报价，供应商实扣未独立查询。上轮242仍submission_unknown，最多0.5585算力，未重复提交或篡改账务。

## 证据

`/Users/yuandai/Documents/Codex/2026-11-13/chat-edit-result/`：源码起点、data-before/after、metrics.json、tests/result-tests/types/build.log、quote.png、generating.png、comparison-in-chat.png、original-2109.png、candidate-2110.png。

本轮完成云高光新图及原对话展示；森林改色基准、飞机单个化、整镜新视频均不在本次完成结论内。
