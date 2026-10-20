# BP-07 诊断：判分成功后界面不显示结果

**日期**：2026-10-20
**性质**：只诊断、不改产品代码（第 19 批第 2 步）
**上游**：任务书 §1.3；第 18 批 `SUP_B6_grade_network.json` / `SUP-B6-*.png`

---

## 1. 结论（已定位）

**根因类别**：前端本地状态在卡片重挂载时被清空（第 2 类）。
**不涉及** BP-04（出处相关性）或 BP-05/06（统计口径）；判分响应契约可用，无需为显示结果改 API。

**直接机制**：

1. 判分结论只写在 `PracticeCard` 本地 state `note`（`frontend/src/components/PracticeBoard.tsx` **约 L60 / L79 / L209**），渲染为「答错。{reason}」。
2. `grade()` 成功后调用 `onChanged()` → `PracticeBoard.reload()` → `setQuestions`（**约 L79–80、L256–259、L335**）。在 **题目 `id` 集合不变** 时，`key={item.id}` 能保住 `note`——单独判分路径**可以正常显示**。
3. 第 18 批复现时，改前截图生成按钮为「处理中…」（`SUP-B6-before-grade.png`）。此时若 `generate()` 稍后以**新 id 列表**执行 `setQuestions(res.questions)`（**约 L275–278**），React 会卸掉旧 `PracticeCard` 再挂新卡片，`note` 与 `answerText` 一并丢失。网络层 `POST …/grade` 仍可对旧 id 返回 200，但 `setNote` 落在已卸载实例上，界面看不到结果。

**一句话**：不是「`reload` 本身清掉同 id 卡片的 note」，而是「**生成完成替换题目列表（id 变化）导致卡片重挂载**」，叠在「结果只活在本地 state」上；第 18 批截图与本次竞态复现一致。

---

## 2. 复现步骤与证据

### 2.1 单独判分（对照：可显示）

1. 习题本 → 今日练习 → 生成或已有题目。
2. 作答 `不会，42` → 提交判分。
3. **结果**：卡片下方出现「答错。…」；作答文本仍在。

| 证据 | 路径 |
|---|---|
| 截图 | `../../.ai-handoff/batch19-logs/BP07_grade_note_visible.png` |
| 控制台（临时日志，已撤） | `../../.ai-handoff/batch19-logs/BP07_console_after_grade.txt`：`grade response` → `note changed` 为「答错。…」；随后 `reload done` **无**因同 id 导致的真实丢 note |

### 2.2 生成 ∩ 判分竞态（与第 18 批一致：不显示）

1. 今日练习已有卡片时再点「生成今日练习」。
2. 在按钮仍为处理中 / 生成未完成前，对首卡填答并提交判分。
3. 等待生成与判分均结束后观察首卡。

| 观测 | 值 |
|---|---|
| `hasNote`（答对/答错/部分正确） | `false` |
| `answerStill`（作答仍在） | `false` |
| 卡片文案 | 仅题干 + 空作答框 + 按钮，无判分句 |

证据写入：`../../.ai-handoff/batch19-logs/BP07_race_generate_vs_grade.json`。

### 2.3 第 18 批旁证

- `SUP-B6-before-grade.png`：作答「不会，42」，生成钮为「处理中…」。
- `SUP-B6-after-grade.png`：作答清空，无「答错。」。
- `SUP_B6_grade_network.json`：`POST /api/practice/94af89fd-…/grade` → 200，`result=wrong`，`reason` 有内容。

---

## 3. 已排查路径（含排除项）

| 路径 | 结论 |
|---|---|
| 后端未返回 reason | **排除**。响应含 `result`/`reason`（第 18 批网络 + 本次对照）。 |
| `grade` → `reload` 同 id 清 note | **排除**。对照复现 note 保留（见 2.1）。 |
| `MistakeBookPage.tsx` **L564** `key={selectedId ?? 'empty'}` | **排除**。该 key 只包在 `board === 'mistakes'` 的 `MistakeDetail` 外层（约 L561–585），不包裹 `PracticeBoard`（约 L543–545）。 |
| `PracticeBoard` `key={item.id}` 不稳定 | **排除（单独判分）**。同批 reload 后 id 不变。生成换批后 id 常变 → 重挂载。 |
| CSS / 空 reason 吞掉「答错。」 | **排除**。对照可见完整句子；空 reason 仍会渲染「答错。」（truthy）。 |
| 出处区块未见 | **非本缺陷主因**。出处仅在 `showAnswer === true` 时渲染（约 L143–168）；与 `note` 无关。属展示条件，不是 setNote 失败。 |
| 切「今日练习 / 今日复习」 | **会丢 note**（未挂载的 tab 对应卡片卸载）。第 18 批主证据更吻合生成竞态，但说明本地 state 脆弱。 |

临时诊断 `console.log` 已从 `PracticeBoard.tsx` **全部撤掉**，产品代码回到诊断前状态（本步不修 BP-07）。

---

## 4. 与任务书猜想对照

| 任务书 §1.3 方向 | 诊断结果 |
|---|---|
| `MistakeBookPage` selectedId key | 已排除 |
| `onChanged` → 外层重挂 `PracticeBoard` | 单独判分未观察到；**生成 `setQuestions` 换 id** 才重挂卡片 |
| `item.id` 在 reload 后是否变化 | 单独 reload：**不变**；`generate` 新列表：**常变** |
| reason 为空 / CSS | 已排除 |

---

## 5. 对第 3 步修复的约束（供编排，本步不实施）

- 属**第 2 类**前端问题；不要为显示 note 提升到全局 store（任务书禁止）。
- 不要改判分响应契约。
- 候选方向（仅记录，未做）：避免在生成完成时无条件打掉仍在作答/判分中的卡片状态；或把「最近一次判分文案」挂在按 `questionId` 索引的 board 级 map（仍非全局 store）；生成进行中禁用判分等。具体方案待编排批准第 3 步后再做。

---

## 6. 本步状态

| 项 | 状态 |
|---|---|
| 根因 | **已定位**（见 §1） |
| 产品代码修复 | **未做**（硬门禁：本步只出文档） |
| 牵涉 BP-04 / BP-05/06 | **否**，六步顺序无需因本诊断重排 |
