# 第 21 批：冻结前未验证项补跑报告

**日期**：2026-10-21

**依据**：`docs/direction.md` §10.18；第 18 批任务书 A13–A15、B8、B1/B13。

**范围**：只验不改；未修改产品代码、测试或迁移。

原始证据在 `../../.ai-handoff/batch21-logs/`。后端用 `backend/.venv/Scripts/python.exe` 启动，连接从 `backend/studypilot.db` 备份的**隔离 SQLite 快照**；前端为本地 Vite。所有验收写入只发生在快照。快照及撤销前副本已在生成脱敏结果后删除，原库修改时间仍为 `2026-10-21 13:20:32`。本批没有重新运行全量测试；最近一次总规划复跑基线为后端 `2 failed / 624 passed / 86 subtests`（两条 bilibili DNS）、前端 `34 files / 133 passed`。

## A13–A15 补强后链路：通过，附语义边界

复用第 18 批走查账号 `walk18_cb77ed2a` 及其已确认补强调整，只在隔离快照继续操作。

1. **A13 重测与判分**：`POST /api/practice/reinforce-retest` 返回 200、9 题。提交第一题的标准答案到 `POST /api/practice/{id}/grade`，返回 200、`correct`；新增证据 `7058fbdd-a0ec-4384-a4c4-3f5013e15843` 的 `knowledgePoint=b1f22a10-d28b-40c8-81ac-1c80151e069f`，与目标阶段一致。证据：`A13_retest.json`、`A13_grade.json`。接口可能使用模型生成或异常回退，本次没有取得可区分两者的调用轨迹，故不声称“模型生成成功”。
2. **A14 前后数字**：用产品的 `phase_reinforce_outcome` 对原库基线和隔离快照现算：重测前 `before=0%（3 次）`、`after=null（0 次）`、`overall=0%（3 次）`；判分后 `before=0%（3 次）`、`after=100%（1 次）`、`overall=25%（4 次）`。经正常 `POST /api/check-ins` 在**快照**写一条注明“合成验收”的打卡，以满足周报容器前置条件；`GET /api/weekly-reviews/latest` 返回同一组补强结果。证据：`A14_outcome_comparison.json`、`A14_snapshot_checkin.json`、`A14_weekly_after.json`。合成打卡不是用户真实学习记录。
3. **A15 撤销**：撤销前两条本批补强任务均为 `done`，各有一条 `reinforce_task_evidence` 关联。`POST /api/plans/{id}/adjustments/undo` 返回 200、`undone`；撤销后这两条任务及关联均不存在，周报 `reinforceOutcomes=[]`。证据：`A15_undo.json`、`A15_db_comparison.json`、`A15_weekly_after_undo.json`。

**撤销语义需如实讲**：掌握度作答证据仍按历史保护规则留存，证据总数撤销前后均为 18。由于补强任务及关联已删除，那次重测的正确证据不再归入 `after`，而进入 `before`；现算 `overall=25%（4 次）`，并**不会恢复**到重测前的 0%。因此“已完成补强任务连同完成状态回滚”已验证；不能把它解说成“答题历史也被删除”或“掌握度恢复原值”。

## B8 顺延提醒：触发与按需请求通过，确认未测

第 18 批 B2 测试账号在隔离快照中 `GET /api/statistics/overview` 返回 `overdueCount=1`。浏览器实见“你有 1 项任务未完成……”及“生成顺延预览”按钮。进入统计页时记录的网络请求中没有 `remedy-preview`；实点按钮后才出现 `POST /api/plans/601948d8-85d1-40cc-bcd1-292a3b177d50/remedy-preview`，响应 200。证据：`B8_overview.json`、`B8_load_requests_B2.json`、`B8_load_requests_B2_late.json`、`B8_click_network.json`、`B8_click_late_responses.json`、`B8-overdue-full.png`、`B8-after-click-ready.png`。

该预览仍为 `pending`，`validation.ok=false`、`capacity=fail`、`selection=pass`（`B8_preview_summary.json`）；页面也展示容量失败。原任务书 B8 要求的是提醒出现及**点击才请求**，这两点通过。由于排程容量约束，此账号未做确认写入，不能声称“顺延已生效”。

## B1/B13 控制台：本次观察窗口内无 error 或 exception

- **B1 总览**：实点并完整重载后页面可见。DevTools 事件逐条为 `[vite] connecting...`（debug）、React DevTools 提示（info）、`[vite] connected.`（debug）、设备启用 Reduced Motion 的动画提示（warning）；没有 `error`、`Runtime.exceptionThrown` 或 `Log.entryAdded` 错误。证据：`B1_console_reload.json`、`B1-overview-ready.png`。
- **B13 全屏聊天**：从小窗“展开全屏”进入 `#/mainframe?from=widget`，标题“你的学伴”及顺延预览内容可见。路由切换期间无控制台事件；完整重载只记录一条 React DevTools 提示（info），没有 error 或 exception。证据：`B13_console.json`、`B13_console_reload.json`、`B13-fullscreen.png`。

结论只覆盖上述 Chrome 标签、操作步骤及采集时段，不外推为所有页面永无控制台错误。

## 本批发现、留待单独裁定

总览首屏仍显示 `LEARNING CYCLE · POSTGRAD-2028` 和“天到初试”。它们不是 `test_profile_routes.py` 的测试夹具：源码分别硬编码于 `frontend/src/components/GoalCard.tsx:84`、`frontend/src/components/MetricsRow.tsx:26`，真实浏览器图 `B1-overview-ready.png` 可见。与当前 AI 职业规划定位有明显口径冲突。本批不修改；请总规划决定是否单独开文案批及演示前优先级。

## Git 与环境

`docs/direction.md` 1.9.3 已先单独提交 `06616d7`。本报告之外没有提交任何验收快照、测试账号数据或产品改动。验收后已停止本轮启动的 8000/5173 服务，删除含账号数据的 SQLite 快照；仓库原有 9 个 CRLF 假脏文件没有暂存、提交或 checkout。
