# 第 19 批断点修复复审报告

依据：`.ai-handoff/batch19-breakpoint-fixes-2026-10-20.md`。六步分别提交，未推送；`journey-wt` 未触碰。基线后端为 **2 failed / 618 passed / 86 subtests**，两条失败均为既有 Bilibili DNS 问题。

## 1. BP-02：统计页接入周报

- **根因**：`weekly` 导航落到 `StatisticsPage`，该页原先没有周报内容；`WeeklyReviewPage.tsx` 没有入口。
- **改动**：统计页顶部接入 `StatisticsWeeklyReview`，复用周报数据、紫环和三指标；无证据显示“暂无数据”；阶段双环保留。
- **证据**：[改前](../../.ai-handoff/batch19-logs/BP02_statistics_before.png) / [改后](../../.ai-handoff/batch19-logs/BP02_statistics_after.png)。
- **验证**：`npm run typecheck` 通过；当步前端 33 文件、131 测试通过。原始输出见 [typecheck](../../.ai-handoff/batch19-logs/frontend-typecheck-bp02.txt) 与 [测试](../../.ai-handoff/batch19-logs/frontend-test-bp02.txt)。
- **提交**：`c0ed41d`。`WeeklyReviewPage.tsx` 仍是死文件，按任务书只记录。

## 2. BP-07：先诊断

- **根因**：`PracticeBoard.tsx` 中判分结论只存于 `PracticeCard` 本地 `note`；生成请求完成后 `setQuestions` 用新题替换原数组，旧题卡重挂载，`note` 与作答一起消失。单独判分后 `id` 稳定，结论能够显示。`MistakeBookPage` 的 `key={selectedId}` 已排除。这是生成与判分竞态，与 BP-04/05/06 无关。
- **改动**：仅写 [诊断文档](batch19-bp07-diagnosis.md)，没有修复代码或临时日志残留。
- **证据**：[单独判分可见](../../.ai-handoff/batch19-logs/BP07_grade_note_visible.png)、[竞态请求](../../.ai-handoff/batch19-logs/BP07_race_generate_vs_grade.json)。具体行号与排除过程见诊断文档。
- **提交**：`52ee9ca`，与修复严格分开。

## 3. BP-07：修复

- **根因**：同第 2 步。
- **改动**：生成新题时按 `id` 保留旧卡片，让并发判分的本地结果留在原卡片；新增 `PracticeBoardGeneration` 回归测试。未引入全局 store，也未改判分响应契约。
- **证据**：真实浏览器中并发触发“生成今日练习”和“提交判分”，新题生成后旧卡片仍保留作答及“答错。{reason}”。第 2 步的复现请求是改前对照；改后浏览器截图在本批编排对话中，文件化证据尚缺。
- **验证**：`npm run typecheck` 通过；当步前端 34 文件、133 测试通过。
- **提交**：`b6a0d10`。

## 4. BP-04：出处相关性

- **根因**：BM25 只要求分数大于零，通用词重叠也能命中；生成把整批资料 hits 挂到每道题；判分也把无关资料送入提示词。
- **改动**：出处检索要求题干词项覆盖率至少 `0.25`，并逐题检索；无相关片段返回 `sourceRefs: null`。判分用题干检索，不再让作答文本制造伪相关。旧库行保持原样，在 API 序列化时过滤错误出处。通用检索默认覆盖率仍为 `0`。
- **阈值依据**：[逐片段测量](../../.ai-handoff/batch19-logs/BP04_threshold_basis.json)显示，第 18 批真实财务题对四条错误二分查找片段的最大覆盖率为 `0.154`；相关的“先序和中序能否唯一确定二叉树”样本为 `0.538`。`0.25` 能隔开这两类已观察样本；这不是语义相关性的普适保证，后续若要扩大资料领域，应由总规划审定阈值或改用更强校验。
- **证据**：[第 18 批原题](../../.ai-handoff/batch18-logs/A8b_source_refs_summary.json) 的“请列出资产负债表中5个常见项目。”原挂四条二分查找 PDF；[当前代码复算](../../.ai-handoff/batch19-logs/BP04_finance_sourceRefs_after.json) 的 `afterSourceRefs` 为 `null`。
- **验证**：指定五个测试文件 **34 passed**，相邻任务与阶段测试 **13 passed**。仅获授权更新 `test_generate_reinforce_retest_omits_unrelated_source_refs` 这一条旧断言：题干“重测题”没有资料内容可支持，期望从非空出处改为 `null`；真正相关题目的非空断言仍在。
- **提交**：`ec4c09b`。复审结论：通过，但需总规划评估 `0.25` 的长期产品口径。

## 5. BP-05/06：统一作答统计

- **根因**：星图按 `MasteryEvidence` 数作答，累计与日柱图按 `PracticeQuestion.status != pending` 数；判分只写前者，因此同日出现星图 2 道、累计 0。
- **改动**：累计与近 30 日每日柱图改数 `MasteryEvidence`。未写 `PracticeQuestion.status`，未改 `_day_of` UTC、星图 +8 的既定日期口径。
- **证据**：新回归测试改前失败 `0 != 2`；改后隔离数据中实际 `GET /api/statistics/overview` 返回 [累计 2、当日柱图 2、星图 2](../../.ai-handoff/batch19-logs/BP05_06_overview_after.json)。该样本选本地中午，避开既知的跨日口径差异。
- **验证**：`test_statistics_progress.py` 与 `test_weekly_review_service.py` 合计 **28 passed / 6 subtests passed**。只新增测试，未改既有断言。
- **提交**：`eaa8280`。复审结论：通过。

## 6. BP-08：禁用文案

- **根因**：左栏把总体进度称为“当前学习效率”；标准推理档写“速度与质量均衡”。
- **改动**：左栏改为“总体进度”；标准档改为“适合日常学习与一般问答”；同步左栏相关注释。
- **证据**：扫描 `frontend/src` 后，面向用户的“效率/速度/用时/节省”已无命中。真实浏览器个人中心已显示“总体进度”。`ProfilePage.tsx:22` 尚有一处非产品注释“效率概览”，不影响界面。
- **验证**：`npm run typecheck` 通过；`npm run test` 为 **34 文件 / 133 passed**。原始输出见 [typecheck](../../.ai-handoff/batch19-logs/frontend-typecheck-bp08.txt) 与 [测试](../../.ai-handoff/batch19-logs/frontend-test-bp08.txt)。
- **提交**：与本报告同笔提交。

### “备考”字样留待总规划裁定

按任务书不改：`GoalCard.tsx:110,145` 面向用户；`LeftRail.tsx:80` 面向用户；`GoalCard.tsx:40,104`、`goalProgress.ts:2,11` 为注释；`resourceRequest.ts:14` 是资源请求识别规则。请总规划决定是否与 AI 职业规划定位统一；本批不扩大范围。

### 批次复审

第 4、5 步均按第 1 类复审，六步提交边界独立。后端全量测试为 **2 failed / 623 passed / 86 subtests passed**；失败仍仅是两条 Bilibili DNS 测试，与开工基线相同，新增 5 条后端测试通过。原始输出在 [全量日志](../../.ai-handoff/batch19-logs/backend-full-after-batch19.txt)。`BP-07` 改后截图需补文件化证据；其余指定对照已留日志或截图。

需总规划确认：是
需批次编排确认：是
