# 第 18 批：冻结前集成验收走查报告

**日期**：2026-10-20（含复审补跑修订）
**仓库**：`study-pilot`
**性质**：只跑不修；本文件为唯一交付物（产品代码/测试/迁移/Git 均未改）
**走查账号**：
- 主账号 `walk18_cb77ed2a`（原 A/B 主链路；补跑未覆盖其计划）
- B2 补跑 `walk18b2_225ea681`（独立计划，不覆盖主账号）
- B11 补跑 `walk18b11_b2ca2af7`（注册时 `assistantName` 为空）

**原始日志根目录**（相对本文件 `docs/`）：`../../.ai-handoff/batch18-logs/`
绝对路径：`C:\Users\MECHREVO\Desktop\studypilot\.ai-handoff\batch18-logs\`
临时脚本（未入库）：`../../.ai-handoff/batch18_a_*.py`、`batch18_sup_*.py`

**分类约定**：
- **实测产品缺陷**：网络/界面复现，与预期产品行为不符
- **演示数据/前置条件不足**：门禁或校验按设计挡住；未建立所需状态，**不**据此断言门槛代码 bug
- **未验证 / 未完整核验**：缺少逐步证据（含控制台逐条日志）

---

## 0. 开工基线

| 项 | 结果 | 证据 |
|---|---|---|
| 后端 pytest（`.venv`） | **2 failed / 618 passed / 86 subtests passed**；324.97s | `../../.ai-handoff/batch18-logs/pytest-baseline.txt` 末行 |
| 失败用例 | `test_video_link` 两条 bilibili DNS：`BV1SiDYBeET5`、`BV1b7411N798` | 同上；**标为既有非回归** |
| 前端 typecheck | 退出码 0（仅 npm env warn） | `frontend-typecheck.txt` |
| 前端 vitest | **32 files / 129 tests passed** | `frontend-test.txt` |

除上述 2 条 DNS 外，基线无新增失败。

---

## 1. 断点清单（按严重度，已按补跑重排）

### 阻断

#### BP-02 B10 独立「周报页」从主应用进不去
- **类别**：实测产品缺陷
- **步骤**：B10
- **期望**：真实点击进入 `WeeklyReviewPage`，核对双环、掌握度证据条数、无证据显示 null 而非 0%
- **实际**：总览「打开学习周报」落入 **数据统计**（`StatisticsPage`）。源码 `App.tsx`：`weekly: StatisticsPage`；`WeeklyReviewPage.tsx` 存在但未挂入 `PAGES`
- **证据**：浏览器点击后页面文案为 `STATISTICS / 数据统计`；`frontend/src/App.tsx:26`
- **严重度**：阻断（任务书点名的周报页从未在主链路可点开）

### 明显

#### BP-04 A8/A11 题目出处与题干主题错位
- **类别**：实测产品缺陷
- **步骤**：A8、A11、B6
- **期望**：`sourceRefs` 指向与题目相关的资料片段
- **实际**：财务/Excel 题干齐全且均带 `sourceRefs`，但每条 refs 的 `filename` 均为「算法基础-二分查找与对数时间复杂度.pdf」，snippet 为二分查找正文
- **证据**：`A8b_source_refs_summary.json`；`A11b_phase_quiz_with_done.json`；补跑 `SUP_B6_grade_network.json`（grade 响应仍绑同一 PDF）
- **严重度**：明显

#### BP-05 C1 同日星图有作答、作答量图显示暂无数据
- **类别**：实测产品缺陷（口径不一致，观众可见）
- **步骤**：C1、B7
- **实际**（同页可见）：
  - 星图：`10-20：2 道 · 正确率 0%`；无作答日：`09-21：这天没有作答`
  - 「近 30 日作答量」：`暂无数据，继续加油`
  - API：`stars` 当日有作答；`dailyActivity` 当日 `count=0`（`A10b_overview_after_grade.json`）
- **证据**：`B7-statistics.png`；`A10b_overview_after_grade.json`
- **严重度**：明显

#### BP-06 统计页「累计作答=0」与星图「今日 2 道」并存
- **类别**：实测产品缺陷
- **步骤**：B7 / A10
- **实际**：顶部「累计作答 0 / 已判分习题」，同时星图「10-20：2 道 · 正确率 0%」，掌握度分布「未掌握 2 题 (100%)」
- **证据**：`B7-statistics.png`；补跑后统计页仍见「0 累计作答」（`SUP-BP03-quiz-enabled.png`）
- **严重度**：明显

#### BP-07 B6 判分成功后界面未显示结果
- **类别**：实测产品缺陷（非偶发「不稳」）
- **步骤**：B6（补跑再点）
- **期望**：出题、作答、判分结果可见、出处可展开、「讲给 AI 听」可用
- **实际（补跑）**：
  - 输入框内容：`不会，42`（截图 `SUP-B6-before-grade.png`）
  - 点击「提交判分」后：作答被清空；卡片仍为「我的作答」空框 +「提交判分」；**未见判分理由/对错结果文案**（`SUP-B6-after-grade.png`）
  - 网络：`POST /api/practice/94af89fd-…/grade` **200**，`result=wrong`，reason 说明未列出报表项目且摘录无关（`SUP_B6_grade_network.json`）
  - 随后 `GET /api/practice?date=2026-10-20` 仍返回该题 `status=pending`（与刚成功的 grade 并存，UI 亦无结果态）
- **对照**：API 侧 A9 判分历来成功（`A9b_grade.json`）
- **出处核对边界**：补跑截图中「显示答案」仍未展开；当前组件将出处放在该按钮展开的内容里（`frontend/src/components/PracticeBoard.tsx`），因此本次不能据截图断言出处完全无法展示。出处主题错位另见 BP-04。
- **结论**：判分链路后端可用；**习题本 UI 在判分后未显示结果**——保留为产品缺陷，不再用「不稳」表述
- **严重度**：明显

#### BP-08 C3 仍有「效率/速度」类产品向表述
- **类别**：实测产品缺陷（文案）
- **步骤**：C3
- **实际**：个人中心 `当前学习效率`；模型偏好 `速度与质量均衡，日常学习推荐`
- **证据**：`B4-profile.png`；界面实见
- **严重度**：明显

### 已降级 / 改判（勿再当代码阻断）

#### BP-01（原）A12–A15 补强主链路 — 改判为前置条件 + 部分未复验
- **类别（首轮）**：演示数据/前置条件不足
- **首轮实际**：进度约 8%；预览 `validation.ok=false`，`checks.divergence=fail` / `scan_divergence=empty`；确认 409；撤销 404
- **补跑（仅正常 API，未改库）**：
  1. 批量 `PATCH /api/daily-tasks/{id}/status` → 阶段 `progressPercent=100`（`SUP_bp_phase_detail_after.json`）
  2. 补齐错题证据后预览：`validation.ok=true`，`divergence=pass`，提出 2 条任务（`SUP_bp_reinforce_preview_full.json`）
  3. 确认 200，写入 2 条补强任务（`SUP_bp_reinforce_confirm.json`、`SUP_bp_tasks_after_confirm.json`）
- **分类说明**：首轮「做不完」**不能**断言为补强门槛 bug；门槛在数据齐备时可通过。
- **仍未完整验证**：补跑未再走完 A13 重测→A14 掌握度前后数字→A15 撤销回滚；这些标为 **未验证**，不升格为缺陷。
- **证据汇总**：`SUP_bp01_bp03_probe.json`、`SUP_bp01_bp03_summary.txt`

#### BP-03（原）B9 阶段测验 UI — 改判为前置条件；补跑后演示路径已通
- **类别（首轮）**：演示数据/前置条件不足（进度 8%，按钮 disabled + `title="该阶段完成后才能测验"`）
- **补跑**：阶段任务全部 done → 100%；确认补强后一度 92%（新增 pending）；再 mark 补强任务 done → 再次 100%（`SUP_bp03_mark_done_for_quiz.json`）
- **UI**：数据统计「学习航线」阶段一 **进度 100%**，「开始测验」**enabled**（`title=开始该阶段测验`）；点击后进入习题本题目列表（`SUP-BP03-phase100-quiz-enabled.png`、点击后 `SUP-BP03-route-quiz.png`）
- **分类说明**：**不得**把「未完成阶段时禁用测验」列为代码 bug。首轮为数据不足；补跑后演示路径已验证。
- **证据**：`SUP_bp01_bp03_summary.txt`、`SUP-BP03-phase100-quiz-enabled.png`

### 轻微

#### BP-09 A10 星档为 gray 且正确率 0（与答错一致）
- **类别**：观察项（口径一致；笑/哭脸视觉未逐像素确认）
- **证据**：`A10b_overview_after_grade.json`；补跑星图可见有作答日表情（`SUP-BP03-phase100-quiz-enabled.png`）

#### BP-10 A3 API 整体替换会清空其余字段（已知试探）
- **类别**：API 语义风险；UI 表单整表提交不暴露
- **证据**：`A3_put_nickname_only.json`、`A4_put_full.json`；对照 B5 UI

---

## 2. 通过项（附证据）

| 步骤 | 状态 | 证据摘要 |
|---|---|---|
| A0 | 通过 | 真实库迁至 `c8d9e0f1a2b3`；`assistant_name` 列存在；走查号新增。`a0-alembic-upgrade.txt`、`A0_health.json` |
| A1–A7 | 通过 | 见原 A 段日志；A7 资源链为真实课程 URL |
| A8 | 部分通过 | 有题且有 `sourceRefs`；主题错位见 BP-04 |
| A9 | 通过 | API 故意答错 → `wrong`。`A9b_grade.json` |
| A10 | 部分通过 | 字段齐全；附带 BP-05/06 |
| A11 | 通过 | 有已完成任务可出题；无/错阶段 404。`A11b_*.json` |
| A12（补跑） | 通过（条件齐备后） | 预览校验通过 + 确认 200。`SUP_bp_reinforce_preview_full.json`、`SUP_bp_reinforce_confirm.json` |
| A13–A15 | **未验证** | 补跑未完整复测重测/掌握度前后/撤销 |
| A16 | 通过 | `A16b_explain.json` |
| B1 | 通过（界面） | 总览标题「走查：财务数据分析入门」。`B1-overview-walk18.png`。**控制台无报错：未完整核验**（无逐条 DevTools 导出） |
| B2（补跑账号） | 通过 | `walk18b2_225ea681`：选择方向 `AI+财务数据分析` → 生成+澄清「确定」→ `planId=601948d8-…`，3 阶段 → Roadmap。截图 `SUP-B2-form-ready.png`、`SUP-B2-roadmap.png`；`SUP_B2_summary.txt`。**未改主账号计划** |
| B3–B5 | 通过 | 原截图与 API |
| B6 | 部分通过 | 出题/「讲给 AI 听」入口在；判分结果未见 BP-07；出处展开未实点；网络判分成功见 `SUP_B6_grade_network.json` |
| B7 | 部分通过 | 航线门禁文案 OK；星图可区分；累计作答口径见 BP-06 |
| B9（补跑） | 通过（条件齐备后） | 进度 100% 可点「开始测验」并进入习题。`SUP-BP03-phase100-quiz-enabled.png` |
| B11（补跑空名账号） | 通过 | 见 §2.1 |
| B12–B13（主账号有名态） | 通过（界面） | 小窗/全屏标题「小航」。`B11-chat-window.png`、`B13-fullscreen-chat.png`。**控制台无报错：未完整核验** |
| C2 | 部分通过 | 无证据文案可见；周报双环因 BP-02 未在独立页核对 |
| C3 | 失败见 BP-08 | — |

### 2.1 B11 空名账号逐步证据（`walk18b11_b2ca2af7`）

| 步 | 结果 | 证据 |
|---|---|---|
| 首次打开小窗 | 出现起名条：「给你的学伴起个名字？」+「跳过」/「就叫这个」；标题默认「你的学伴」 | `SUP-B11-name-prompt.png` |
| 条存在时可输入发送 | 输入「B11条存在时测试发送」并发送；出现助手回复；起名条仍在 | `SUP-B11-input-with-bar.png`、`SUP-B11-sent-with-bar.png` |
| 点击跳过 | 起名条消失 | `SUP-B11-after-skip.png` |
| 关闭后再开 | **不再出现**起名条 | `SUP-B11-reopen-no-prompt.png` |
| 资料页设名 | 编辑资料 → 助手名字「小航B11」→ 保存 | `SUP-B11-profile-set-name.png` |
| 小窗/全屏标题 | 小窗标题「小航B11」；全屏 `#/mainframe?from=widget` h2「小航B11」 | `SUP-B11-widget-title-renamed.png`、`SUP-B11-fullscreen-title.png` |

汇总：`SUP_B11_summary.txt`

---

## 3. 未执行 / 未验证

| 步骤 | 原因 / 类别 |
|---|---|
| A13–A15 完整补强后链路 | 补跑只验证到确认写入任务；重测/掌握度前后/撤销 **未验证** |
| B8 `overdueCount>0` 顺延 | 走查账号 `overdueCount=0`；**前置条件不足** |
| B10 周报双环 / null | 无独立周报入口（BP-02，产品缺陷） |
| B1/B13「无控制台报错」 | **未完整核验**（未逐条导出 DevTools console） |

---

## 4. A 段步骤结果速查

| # | 结果 |
|---|---|
| A0–A7 | 通过 |
| A8 | 失败（出处主题错位，BP-04） |
| A9 | 通过 |
| A10 | 通过（字段）；附带 BP-05/06 |
| A11 | 通过 |
| A12 | 首轮：前置条件不足；**补跑通过** |
| A13–A15 | **未验证**（补跑未完整复测） |
| A16 | 通过 |

---

## 5. B/C 段步骤结果速查

| # | 结果 |
|---|---|
| B1 | 通过（界面）；控制台未完整核验 |
| B2 | **补跑通过**（新账号完整提交进 Roadmap） |
| B3–B5 | 通过 |
| B6 | 网络判分成功；UI 结果缺失（BP-07）；出处展开未实点 |
| B7 | 部分通过（BP-05/06） |
| B8 | 未验证（overdue=0） |
| B9 | 首轮数据不足；**补跑通过** |
| B10 | 阻断（BP-02） |
| B11 | **补跑通过**（空名账号起名条全流程） |
| B12–B13 | 通过（界面）；控制台未完整核验 |
| C1 | 失败可见（BP-05） |
| C2 | 部分验证 |
| C3 | 失败（BP-08） |

---

## 6. 截图与日志索引

- 基线：`pytest-baseline.txt`、`frontend-typecheck.txt`、`frontend-test.txt`
- A 段：`A0_*.json` … `A16b_*.json`、`a-walkthrough-console.txt`、`a-continue-console.txt`、`SUMMARY.json`
- B 段原截图：`B1-overview-walk18.png`、`B2-goal-form-direction.png`、`B3-roadmap.png`、`B4-profile.png`、`B6-mistakes.png`、`B6-practice-graded.png`、`B7-statistics.png`、`B11-chat-window.png`、`B13-fullscreen-chat.png`
- 复审补跑：
  - B2：`SUP-B2-*.png`、`SUP_B2_*.json`、`SUP_B2_summary.txt`
  - B11：`SUP-B11-*.png`、`SUP_B11_summary.txt`
  - BP-01/03：`SUP_bp_*.json`、`SUP_bp01_bp03_*.json`、`SUP_bp01_bp03_summary.txt`、`SUP-BP03-*.png`
  - B6：`SUP-B6-*.png`、`SUP_B6_grade_network.json`
  - 账号清单（无密码）：`SUP_accounts.txt`

报告不含 token、密码、API Key 或私人数据。

---

## 7. 给第 19 批的断点优先级（与补跑后一致）

1. **周报页路由缺失**（BP-02）— 仍阻断演示
2. **习题本 UI 判分后不显示结果**（BP-07）+ **出处主题错位**（BP-04）
3. **统计双图 / 累计作答口径**（BP-05/06）
4. **禁用词「效率/速度」**（BP-08）
5. （可选）在数据齐备账号上补齐 A13–A15 掌握度前后与撤销的完整演示脚本 — **属验收覆盖，非已证实代码缺陷**
6. ~~补强门槛 / 阶段测验禁用~~ — 补跑表明为**前置条件**；勿优先当 bug 修

---

## 8. 复审变动摘要

| 项 | 变化 |
|---|---|
| 日志路径 | `../.ai-handoff/` → **`../../.ai-handoff/batch18-logs/`**（相对 `docs/`） |
| B2 | 新账号真实提交路线 → **通过** |
| B11 | 空名账号起名条/跳过/资料改名/双标题 → **通过** |
| BP-01 | 由「阻断代码」→ **前置条件不足**；条件齐备后确认成功；A13–A15 仍未验证 |
| BP-03 | 由「阻断代码」→ **前置条件**；100% 后 UI 可测并跳转 |
| B6 | 网络 200 `wrong`；UI 无判分结果 → **明确产品缺陷**；出处展开未实点，去掉「不稳」 |
| B1/B13 控制台 | 标为 **未完整核验** |
| 断点排序 | 阻断仅保留 BP-02；BP-01/03 移出代码缺陷队列 |

---

需总规划确认：是
需批次编排确认：是
