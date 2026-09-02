# 用 Codex 维护美术词库

词库真相源是 `entries/*.yaml`，筛选总表是 `WORD_BANK.md`。下面这些话可以直接发给 Codex。

## 筛选现有卡

```text
请先读 docs/style-library/WORD_BANK.md 和 MANUAL.md。按我的决定维护词库：
保留：【id】
待修改：【id + 修改方向】
淘汰：【id】

不要增加界面。不要直接删除或停用已经 active 的卡；先列出影响，等我确认。
```
## 新增一张候选卡

```text
请在美术词库里新增一张候选卡。先读 WORD_BANK.md、MANUAL.md、_TEMPLATE.yaml，并检查现有 entries 避免重复。

我的内容：【艺术参照 / 媒介 / 色调 / 情绪 / 生命体验 / 时间 / 服装等】

要求：
- 新建 entries/<id>.yaml，status 保持 draft。
- 艺术家和作品传统只写 internal_references 或 provenance。
- 发给图片模型的 style/provider_fragments 只写可观察画面特征。
- 年龄只能来自明确资料，只作弱辅助，不能单独触发。
- 时间、季节和服装没有证据就留空。
- 写清 signature、negative、selection_context 和 counter_signals。
- 不增加 automatic_selection，除非我明确要求这张卡进入自动选择。
- 同步更新 WORD_BANK.md，并运行词库测试。
```

## 用一张好图或一段好提示词精修

```text
请精修美术词库卡：【id】。
参考图或提示词：【内容】

把可观察特征拆进 style、palette、light、composition、material、signature 和 negative；艺术家姓名只留在 internal_references。不要改 id，不要擅自改 active/draft，不要替用户补情绪和人生经历。同步 WORD_BANK.md，并说明改了哪些画面语言。
```

## 校准后转正

```text
这些卡我已经筛选并出图校准，可以转 active：【id 列表】。
只改 status；如果还没有 automatic_selection，保持手动可用，不要擅自增加情绪触发。同步 WORD_BANK.md 并运行词库测试。
```

## 只做光谱体检

```text
请只读检查整个美术词库，不改文件。按媒介、色温、年代、繁简、情绪温度比较所有卡，列出重复、空位、艺术家姓名泄漏、年龄刻板印象和没有证据的时间/服装规则。我决定后再改。
```
