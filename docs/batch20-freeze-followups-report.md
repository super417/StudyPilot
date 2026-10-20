# 第 20 批冻结前补项：验收报告

依据：`docs/direction.md` 1.9.2 §10.17 和父目录 `.ai-handoff/batch20-freeze-followups-2026-10-20.md`。只处理 BP-04 阈值、BP-07 改后截图、三处“备考”文案。

## 1. BP-04 阈值 0.43：复审通过

- `_SOURCE_MIN_COVERAGE` 改为 `0.43`，生成、旧出处展示过滤和判分侧共用；在 `test_retrieval.py` 新增真实语料压缩夹具的回归测试。新测在旧 `0.25` 下先失败：Python bool 题误挂通用片段；在 `0.43` 下通过。
- 按任务书指定的五个后端测试文件合跑，结果 **1 failed / 34 passed**。失败是既有 `tests/test_practice_grading.py::PracticeGradingTests::test_explanation_evidence_enters_phase_mastery_average`。夹具以“可导条件”为题，资料是“中值定理要求函数在闭区间连续、开区间可导”；查询去重词项 3 个，片段命中 1 个，覆盖率 **0.333**。在 `0.43` 下 `_source_for_grade` 无摘录，`explain_answer` 因 `require_source=True` 抛出 `ExplanationInsufficientEvidenceError`。
- 总规划允许修对应既有测试，判断可能是 `reason` 中「摘录」或「原文」的断言过时。实际失败发生在判分器调用之前，并无这类 `reason` 断言。把该测试题干改为「中值定理要求函数在开区间可导吗？」以匹配原有资料夹具；保留 `explain_answer` 必须有真实摘录才记录口述证据的约束，判分产品逻辑没有变化。该文件仅改这一条测试的题干。
- 五个指定后端测试文件重跑 **35 passed**。[裁定前失败原始输出](../../.ai-handoff/batch20-logs/backend-targeted.txt)、[裁定后原始输出](../../.ai-handoff/batch20-logs/backend-targeted-after-ruling.txt)。红测过程在本批对话工具输出中有记录；旧门槛下测试显示误挂列表。复审通过，本地提交 `8ea8502`，未推送。
- `0.43` 仍是**当前 88 题 × 10 片段语料的经验值**。扩展资料领域、多课程或多学科时必须重新测量误挂与漏挂并上报总规划，不许直接沿用。

## 2. BP-07 改后截图：已落盘

2026-10-20 23:35（中国标准时间），在本地 `http://127.0.0.1:5173/` 登录后的习题本「今日练习」中，用已有 Python 类型题实跑：先填写作答，触发「生成今日练习」，看到按钮变为「处理中…」时提交旧题判分。判分返回“部分正确”；随后生成完成，页面显示「已生成 8 题」并新增 8 张题卡。旧题的原作答与判分文案仍同时存在。截图 [BP07-generation-grade-after.png](../../.ai-handoff/batch20-logs/BP07-generation-grade-after.png) 已落盘（30,996 字节）；浏览器 DOM 也确认旧题作答和判分文案仍保留。该账号的练习数据因此新增 8 题，并写入本次旧题判分记录。

## 3. “备考”产品文案：通过

- `GoalCard.tsx` 的无障碍标签和圆心小字、`LeftRail.tsx` 的提示语，按 §10.17 改为“目标期限”口径。其余 5 处“备考”只在注释和用户输入识别正则中，保持不动。
- `npm run typecheck` 通过；`npm run test` **34 文件、133 测试通过**。[typecheck 原始输出](../../.ai-handoff/batch20-logs/frontend-typecheck.txt)、[前端测试原始输出](../../.ai-handoff/batch20-logs/frontend-test.txt)。
- 本地提交：`f98df5d`，未推送。

## 提交与工作区

规划文档 `direction.md` 单独提交为 `0d40976`；文案提交为 `f98df5d`；BP-04 提交为 `8ea8502`。原有 9 个仅行尾符差异的假脏文件未暂存、未提交、未 checkout。本报告更新另行提交，全部仅本地、未推送。
