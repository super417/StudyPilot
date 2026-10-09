# Cursor 任务说明 · 第 1 批（D3 / B1 / G5 / C2）

> 本批 4 项。**背景与完整缺口清单见同目录另外两份文档**，本文只讲这 4 项怎么做。
> 2026-10-09 起，参赛与后续批次的提交、过程记录以工作区 `.cursor/skills/ai-competition-prep/SKILL.md` 为准。本文「立刻 git commit」不覆盖该技能。
> - `项目体检-缺口清单.md` —— 全部缺口（A~F）
> - `需求补充-Roadmap每日任务与错题本.md` —— G1~G5 的完整设计

---

## 使用说明（先读这段）

**1. 本批 4 项一次做完**，按下面顺序：

| 序号 | 项目 | 体量 | 风险 |
|---|---|---|---|
| 1 | D3 清过时注释 | 5 分钟 | 无 |
| 2 | B1 重新规划保留历史 | 中 | **高**（动规划重建逻辑） |
| 3 | G5 练习出题 | 大 | 中（新表 + LLM） |
| 4 | C2 助手引用溯源 | 大 | 中（改助手消息契约 + 迁移） |

**2. 每完成一项，立刻 `git commit`，不要攒到最后。**
commit message 以项目编号开头，例如：

```
D3: 清理 profileMock 过时 TODO 注释
B1: 重新规划保留历史快照（新增 plan_revisions 表）
G5: 练习出题模块（practice_questions 表 + 生成/上传/判错）
C2: 助手回答带知识库出处（citations）
```

4 项 = 4 个 commit。**这样任何一项出问题都能单独回滚和定位。** 这是「一次做完」的代价，必须遵守。

**3. 每完成一项，立刻跑一次测试，不要攒到最后。**
全做完后再跑一次全量作为最终验收。

```bash
cd frontend && npm run build
cd backend && .venv/Scripts/python.exe -m pytest tests -q
```

`npm run typecheck` 是假绿的（走空壳 tsconfig），**不能**作为通过依据。
后端全量约 **4 分 40 秒**，基线 `298 passed, 55 subtests passed`，**这个数字不能变少**。

**4. 已确认的前提，不用再问：**

- **B1 按方案 A（只读快照）实现**，不需要征求 A/B 选择。
- **C2 已获授权修改后端**。

**5. 报告只需最后给一份汇总**，不用每项写长报告。汇总包含：

- 每项一行：改了哪些文件 + 该项的测试结果
- 4 个 commit 的 hash
- 最终全量测试输出
- 没做完 / 没把握的部分

**6. 不要顺手改无关代码。** 不改视觉令牌、不重构没点名的组件、不升级依赖。

**7. 有既有测试被改动时，必须在汇总里单列**，说明为什么改、改成什么。

---

## 第 1 项 · D3 清掉过时注释

### 目标

`frontend/src/mocks/profileMock.ts` 里有 6 条 `TODO(backend): 对接 GET /api/xxx（待后端实现）`，
**实际早已全部对接完成** —— `frontend/src/lib/profileStudyApi.ts` 里这些函数全部走真实接口
（`fetchOverviewMetrics` / `fetchDailyTasksForDates` / `fetchLatestWeeklyReview` / `listMistakes` /
`listDocuments` / `listNotes` / `fetchCourseOverview` / `fetchLatestPlan`）。

### 做法

1. 删掉这 6 条 TODO 注释（约在 `profileMock.ts` 的 104 / 117 / 131 / 143 / 180 / 192 行）。
2. **保留**文件里的类型定义 —— `profileStudyApi.ts` 仍然 `import type` 这些类型，删了会编译失败。
3. 顺手在文件头补一句说明：本文件只提供类型，数据由 `lib/profileStudyApi.ts` 从真实接口派生。

### 验收

- `npm run build` 通过。
- 全文再 grep 一遍 `TODO`，确认没有残留的假 TODO。

---

## 第 2 项 · B1 重新规划不再清空历史

### 问题

`planner_service._write_plan_structure`（约 578 行）是**先删后建**：

```python
session.execute(delete(DailyTask).where(DailyTask.plan_id == plan.id))
session.execute(delete(Phase).where(Phase.plan_id == plan.id))
```

`POST /api/plans/{plan_id}/regenerate` 复用它 → **用户学一个月后点一次「重新规划」，
30 天的 DailyTask 记录和阶段进度全部归零**。`CheckIn` 有独立 `user_id` 不受影响，
所以表现是「打卡还在、任务进度没了」，最容易让人困惑。

### 已确认：按方案 A（只读快照）实现

「不清空历史」有两种理解，**本批已拍板按 A 做，不用再问**：

| 理解 | 含义 | 代价 |
|---|---|---|
| **A. 只读快照** ✅ 本批采用 | 历史记录还能查（审计、统计、演示时展示「变化前后」），但不需要在上面勾任务 | 低 |
| B. 历史可操作（本批不做） | 旧阶段旧任务仍然出现在 Roadmap 上，还能勾选 | 高 |

不选 B 的理由：B 会撞上两个硬约束 —— `Phase` 有 `UniqueConstraint(plan_id, phase_index)`，
新旧阶段抢同一个 index；`DailyTask.phase_id` 是 FK，旧 Phase 一删任务就成孤儿。
改这两个约束在 SQLite 上要重建表，风险不值得。

### 方案 A 的实现（只读快照）

1. **新表 `plan_revisions`**（`backend/app/models/entities.py`）：

| 字段 | 说明 |
|---|---|
| `id` | Uuid PK |
| `plan_id` | FK `plans.id`，`ondelete="CASCADE"` |
| `revision_no` | 整数，同一 plan 内递增 |
| `snapshot` | `Text`，存 `{"phases":[...],"dailyTasks":[...]}` 的 JSON |
| `reason` | 触发原因，如 `"regenerate"` |
| `created_at` | 时间戳 |

2. **归档时机**：在 `_write_plan_structure` **删除子表之前**，先调用
   `planner_service._snapshot_plan(session, plan, reason="regenerate")` 把当前结构序列化存进 `plan_revisions`。
   - 注意 `_write_plan_structure` 也被首次 `generate_plan` 调用，那时没有历史可存 ——
     用 `reason` 参数区分，首次生成传 `None` 跳过快照。
3. **读接口**：`GET /api/plans/{plan_id}/revisions` 返回修订列表（只给 `id` / `revision_no` / `created_at` / `reason`，**不带 snapshot**，列表不该背大 JSON）；
   `GET /api/plans/{plan_id}/revisions/{revision_id}` 返回单份完整快照。
4. **迁移**：新增 alembic 迁移建表。参考 `c4f1a7b93e20_add_conversations_and_chat_messages.py` 的写法。

### 验收

- 生成规划 → 标记几个任务 done → 重新规划 → **旧记录能在 revisions 接口里查到**，且新规划正常生效。
- 首次生成规划**不会**产生空快照。
- 后端全量测试保持 298 全绿（`_write_plan_structure` 的既有测试要同步适配新签名）。

---

## 第 3 项 · G5 练习出题

### 目标

按当天学过的内容自动生成练习题；做错的题自动进错题本复习队列；也支持自己上传好题。

### 完整设计

**表结构、接口签名、验收标准全部写在 `需求补充-Roadmap每日任务与错题本.md` 的 G5 一节**，
本节不重复。动手前先读那节，重点：

- 新表 `practice_questions`（字段表见原文）
- `backend/app/routers/practice.py` 五个接口
- **关键联动**：`PATCH /api/practice/{id}/status` 传 `wrong` 时**自动创建一条 `Mistake`**
- 生成逻辑复用 `ai_proxy` + `NoVerifiedApiConfigError` 模式（未配置 key 返回 400 `NO_API_KEY`，不产生副作用）
- 解析失败要有确定性兜底（照 `planner_service._heuristic_plan_structure` 的写法），**不要让接口 500**

### 本批补充要求

1. **生成入口先做手动触发**（页面上一个「生成今日练习」按钮），不要做定时自动生成 —— 定时器是另一个话题。
2. 题目数量限制 **5～10 道**，写进 prompt 约束。
3. 前端 `frontend/src/lib/practiceApi.ts` 照 `mistakesApi.ts` 的风格写（`apiRequest` + 显式类型）。
4. 前端左侧导航改造见 `需求补充` 文档 G4 一节 —— **G4 和 G5 一起做**，否则新接口没有入口。

### 验收

- 点「生成今日练习」→ 出题并落库；未配置 API key 时给明确提示而非报错。
- 练习题标记「做错」→ 错题本「今日错题」里立刻出现。
- 自己上传的题目出现在习题列表，可标记、可删除。

---

## 第 4 项 · C2 助手回答带知识库出处

### 前提：已获授权

这项要改后端助手契约 + 加数据库字段。**已确认放开「禁止修改后端」的限制，可以直接做，不用再问。**

### 现状

- `assistant_service.build_chat_messages`（约 126 行）把知识库摘录塞进 prompt，
  prompt 里只写了一句「知识库摘录：无（请勿伪造引用）」。
- `_list_user_doc_ids`（约 94 行）能列出用户文档，但**没有任何地方记录这次回答实际用了哪几段**。
- 所以现在助手说「根据你的资料」时，**无法验证**。

### 要做的事

1. **检索阶段留下痕迹**：`document_service` 里负责取 context 的函数改成同时返回命中片段：

```python
def build_context(session, user_id, document_ids) -> tuple[str, list[dict]]:
    """返回 (拼好的 context_text, hits)。hits 每项含
    {docId, filename, chunkIndex, snippet}。"""
```

2. **存储**：`ChatMessage` 加一列 `citations`（`Text`，JSON 字符串，可空）。需要 alembic 迁移。
3. **传输**：助手 SSE 的 `done` 帧带上 `citations` 数组。
4. **前端展示**：`frontend/src/components/chat/AssistantMessage.tsx` 在气泡下方渲染出处卡片 ——
   显示文档名 + 片段摘要，可展开看原文片段。
5. **绝不造假**：本次回答没有引用任何资料时，**不显示引用区**。空引用比假引用好。

### 验收

- 上传一份资料 → 提一个需要资料才能答的问题 → 助手回答下方出现出处卡片，点开能看到片段。
- 问一个与资料无关的问题 → **不出现**引用区。
- 既有助手测试（`test_assistant_routes.py` / `test_assistant_content_filter.py`）适配后保持全绿。

---

## 全部完成后的回归

```bash
cd frontend && npm run build
cd backend && .venv/Scripts/python.exe -m pytest tests -q
```

后端基线：`298 passed, 55 subtests passed`（约 4 分 40 秒）。**任何一项让这个数字变少，都算没做完。**
