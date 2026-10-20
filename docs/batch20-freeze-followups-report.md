# 第 20 批冻结前补项：阶段报告

依据：`docs/direction.md` 1.9.2 §10.17 和父目录 `.ai-handoff/batch20-freeze-followups-2026-10-20.md`。只处理 BP-04 阈值、BP-07 改后截图、三处“备考”文案。

## 1. BP-04 阈值 0.43：复审未通过，尚未提交

- 工作区把 `_SOURCE_MIN_COVERAGE` 改为 `0.43`，在 `test_retrieval.py` 新增真实语料压缩夹具的回归测试；**既有测试未改**。新测在旧 `0.25` 下先失败：Python bool 题误挂通用片段；在 `0.43` 下通过。
- 按任务书指定的五个后端测试文件合跑，结果 **1 failed / 34 passed**。失败是既有 `tests/test_practice_grading.py::PracticeGradingTests::test_explanation_evidence_enters_phase_mastery_average`。夹具以“可导条件”为题，资料是“中值定理要求函数在闭区间连续、开区间可导”；查询去重词项 3 个，片段命中 1 个，覆盖率 **0.333**。在 `0.43` 下 `_source_for_grade` 无摘录，`explain_answer` 因 `require_source=True` 抛出 `ExplanationInsufficientEvidenceError`。
- 这与 §10.17“既有测试一条都不用改”的预计不符。按任务书硬门禁，**暂停 BP-04 提交，保留常量和新测为未提交 diff，等待总规划裁定**。不能为凑绿自行改旧断言，也不能暗中让判分侧继续使用 0.25。
- [指定套件原始输出](../../.ai-handoff/batch20-logs/backend-targeted.txt)。红测过程在本批对话工具输出中有记录；旧门槛下测试显示误挂列表，恢复 0.43 后新测通过。
- `0.43` 仍是**当前 88 题 × 10 片段语料的经验值**。扩展资料领域、多课程或多学科时必须重新测量误挂与漏挂并上报总规划，不许直接沿用。

## 2. BP-07 改后截图：待补

已启动本地前端和后端，但新浏览器会话处于登录页。正等待用户在本地页面登录测试账号，以便真实复现“生成中判分”并保存截图。第 19 批的单独判分截图不充当本项证据。

## 3. “备考”产品文案：通过

- `GoalCard.tsx` 的无障碍标签和圆心小字、`LeftRail.tsx` 的提示语，按 §10.17 改为“目标期限”口径。其余 5 处“备考”只在注释和用户输入识别正则中，保持不动。
- `npm run typecheck` 通过；`npm run test` **34 文件、133 测试通过**。[typecheck 原始输出](../../.ai-handoff/batch20-logs/frontend-typecheck.txt)、[前端测试原始输出](../../.ai-handoff/batch20-logs/frontend-test.txt)。
- 本地提交：`f98df5d`，未推送。

## 提交与工作区

规划文档 `direction.md` 单独提交为 `0d40976`。原有 9 个仅行尾符差异的假脏文件未暂存、未提交、未 checkout。BP-04 的常量和新测保持未提交，供裁定后继续。
