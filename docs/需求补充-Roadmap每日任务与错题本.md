# 需求补充：Roadmap 每日任务展开 + 任务顺延 + 错题本「习题/错题」分区

> 本文是给 Cursor 的执行说明。**先说清现状与缺口，再给改动清单。**
> **2026-10-09 起**，后续批次路线、验收与留痕以工作区 `.cursor/skills/ai-competition-prep/SKILL.md` 为准。

---

## 使用说明（先读这段，再动手）

**1. 一次只做一块，做完就停。**
不要读完本文就把 G1～G5 全实现。按下面的顺序，**每轮只做一个 G，做完停下来报告**，等确认后再进下一个。

| 轮次 | 内容 | 风险 |
|---|---|---|
| 第 1 轮 | G1 规划粒度 | 低（只改 prompt + 补全兜底） |
| 第 2 轮 | G2 阶段展开 | 低（新增一个 GET + 一个组件） |
| 第 3 轮 | G4 错题本分区 | 低（纯前端，用现有接口） |
| 第 4 轮 | G3 任务顺延 | **高**（改 DB 约束 + alembic 迁移 + 动进度算法） |
| 第 5 轮 | G5 自动出题 | 中高（新表 + LLM 接入） |

**2. 每轮结束必须给出**：改了哪些文件、跑了什么命令、命令的真实输出、还有什么没做。

**3. 本文第 0 节的「现状盘点」是实测过的**（2026-10-04）。若与实际代码不符，**以代码为准**，并在报告里指出哪一条对不上。

**4. 不要顺手改无关代码。** 不改视觉令牌、不重构没点名的组件、不升级依赖。

**5. 每轮改完必跑**（`typecheck` 是假绿的，不能作为通过依据）：

```bash
cd frontend && npm run build
cd backend && .venv/Scripts/python.exe -m pytest tests -q
```

**6. 有既有测试被改动时，必须在报告里单列出来**，说明为什么改、改成什么。

---

## 0. 现状盘点（已实测，2026-10-04）

### 已经有的（不要重做）

| 能力 | 位置 |
|---|---|
| 阶段列表 + 进度 | `GET /api/plans/latest` → `phases[]`；`frontend/src/pages/RoadmapPage.tsx` |
| 单日任务查询 | `GET /api/daily-tasks?date=YYYY-MM-DD`（`routers/study.py`） |
| 任务状态切换 + 阶段进度重算 | `PATCH /api/daily-tasks/{task_id}/status` → `task_service.set_task_status` |
| 补当天任务 | `POST /api/daily-tasks` → `task_service.add_today_task` |
| 错题 CRUD + 拍照识题 | `routers/mistakes.py`（含 `POST /api/mistakes/ocr`） |
| 错题复习阶梯（艾宾浩斯） | `mistake_service.interval_days`：1 / 2 / 4 / 7 / 15 / 30 天，之后翻倍 |
| 错题到期判定 | `mistake_service.is_due` → 列表项 `due: true` |
| 周任务分组展示 | `frontend/src/components/WeekTaskGroups.tsx`（按 `weekLabel` 分组，**只显示本周**） |
| 外部调度调用约定 | `weekly_review_service.run_weekly_generation` —— 「提供纯函数入口，不自行挂载 scheduler」 |

### 缺的（本文要做的）

| 编号 | 缺口 | 性质 |
|---|---|---|
| G1 | 规划粒度太粗，阶段下没有逐日任务 | 后端 prompt 约束问题 |
| G2 | 阶段卡片不可展开，看不到该阶段全部每日任务 | 后端缺接口 + 前端缺 UI |
| G3 | 未完成任务不会顺延到第二天 | 后端全新能力 |
| G4 | 错题本左侧没有「习题 / 错题」分区导航 | 前端改造 |
| G5 | 不能根据当天所学自动出题 | 后端全新能力（需 LLM） |

---

## G1. 规划粒度：细到「每天干什么、学到什么程度」

**根因**：`backend/app/services/planner_service.py` 的 `_PLAN_SYSTEM_PROMPT`（约 327 行）当前约束是：

```
daily_tasks 每阶段至少 1 条
```

一个阶段动辄 1～3 个月，只要求 1 条 → LLM 必然只给几条粗任务。

**改动**：

1. 把约束改成**逐日覆盖**：

```
daily_tasks 必须覆盖该阶段每一天（从 start_date 到 end_date，含首尾），每天至少 1 条，task_date 连续无空缺。
description 必须具体到可执行：写清「学科 + 章节/范围 + 动作 + 产出」，例如
「数学：武忠祥强化第 3 讲极限，做例题 1-12，整理 2 道错题」。
禁止出现「继续学习」「复习一下」这类无法执行的描述。
每天各科的分钟分配之和应接近用户给出的每日可用分钟数。
```

2. 在 `_build_plan_user_prompt` 里补一条硬提示：`- 必须为每个阶段输出逐日任务，日期连续。`

3. 在 `_validate_structure`（约 567 行）之后加**补全兜底**：若某阶段 `daily_tasks` 未覆盖全部日期，用确定性逻辑补齐缺失日期（描述模板参考 `_heuristic_plan_structure`），保证「阶段下每天都有任务」不依赖 LLM 是否听话。

**验收**：生成规划后，任一阶段从 `start_date` 到 `end_date` 每一天都有 `DailyTask` 记录。

---

## G2. 阶段可展开：点阶段 → 看该阶段全部每日任务

### 后端

新增按阶段查任务的接口（二选一，推荐第一个）：

```python
# backend/app/routers/study.py
@router.get("/phases/{phase_id}/tasks")
def list_phase_tasks_route(phase_id: str, user: User = Depends(get_current_user), session=Depends(get_db)):
    """返回该阶段全部每日任务，按 task_date 升序。归属经 Phase → Plan.user_id 校验。"""
```

- service 层加 `task_service.get_phase_tasks(session, user_id, phase_id)`。
- 归属校验照抄 `set_task_status` 的 join 写法：`DailyTask → Plan.user_id`。
- 返回字段沿用 `_task_result`（`id / phaseId / taskDate / weekLabel / description / status`），额外补 `dueCarried` 之类的标记见 G3。
- 阶段不存在或不属于该用户 → 404 `NOT_FOUND`（与 `TaskNotFoundError` 一致，不泄露存在性）。

### 前端

- `frontend/src/components/PhaseList.tsx`：阶段卡片加展开/收起（`aria-expanded` + 键盘可达）。
  - 展开时**懒加载**该阶段任务（不要一次拉全部阶段）。
  - 任务按 `taskDate` 分组，每天一行：日期 + 描述 + 状态勾选。
  - 复用 `RoadmapPage.handleToggle` 的逻辑（`setDailyTaskStatus` → 刷新阶段进度）。
- 建议把 `PhaseList` 的展开态提升到 `RoadmapPage`，与已有 `phases` state 一起管理，避免每张卡各自请求。
- 保持现有视觉令牌：`brand #10B981` / `brandDark #064E3B` / `card` 圆角 `40px`，参考同页已有卡片材质，**不要自创配色**。

**验收**：点击任一阶段卡片可展开，看到该阶段每一天的任务；勾选后阶段进度百分比实时更新；再次点击收起。

---

## G3. 未完成任务顺延（24:00 截止）

### 语义

- 以**本地日期**为准，当天 24:00 为截止。
- 结算时，所有 `task_date < 今天` 且 `status == 'pending'` 的任务视为未完成，**顺延到第二天**。
- 顺延生成的任务描述前缀 `[顺延]`，并记录来源，避免用户困惑。

### 数据模型改动（必须）

`DailyTask.status` 当前有 `CheckConstraint("status IN ('pending','done')")`（`models/entities.py:135`）。新增一个状态值：

```python
CheckConstraint("status IN ('pending', 'done', 'carried')", name="ck_daily_tasks_status_values")
```

并加字段：

```python
carried_from_id: Mapped[uuid.UUID | None] = mapped_column(
    Uuid, ForeignKey("daily_tasks.id", ondelete="SET NULL"), nullable=True
)
```

> 为什么要 `carried` 而不是删掉原任务：删除会破坏历史记录与「当天任务完成率」的统计口径。标记为 `carried` 表示「这天没做完，已顺延」，原记录保留可追溯。

**配套**：`task_service.recompute_phase_progress` 的分母要排除 `carried`，否则顺延后阶段进度永远到不了 100%：

```
分母 = 该阶段 status != 'carried' 的任务数
分子 = 该阶段 status == 'done' 的任务数
```

需要同步更新需求 16.2 的既有测试。

### 结算入口（遵循项目已有约定）

按 `weekly_review_service.run_weekly_generation` 的模式，提供**纯函数入口，不自挂 scheduler**：

```python
# backend/app/services/task_service.py
def settle_overdue_tasks(session: Session, user_id: uuid.UUID | None = None,
                         today: date | None = None) -> list[DailyTask]:
    """把 task_date < today 且仍 pending 的任务顺延到次日。

    幂等：同一条原任务只会被顺延一次（靠 status='carried' 判断）。
    user_id=None 时扫描全部用户，供外部 cron 调用。
    """
```

**再加一层惰性兜底（重要）**：用户不会去配 cron。在 `get_daily_tasks` / `list_phase_tasks` 读取前，对当前用户跑一次 `settle_overdue_tasks`（幂等，成本低）。这样即使没有调度器，用户第二天打开页面也会看到顺延结果。

**迁移**：新增 alembic 迁移，`upgrade()` 里改 CheckConstraint + 加 `carried_from_id` 列。SQLite 改约束需要 batch_alter_table。

**验收**：
- 昨天有 pending 任务，今天打开 Roadmap → 昨天那条变 `carried`，今天多出一条 `[顺延] xxx`。
- 反复刷新不会重复顺延。
- 阶段进度分母不含 `carried` 任务。

---

## G4 + G5. 错题本：左侧分区「习题 / 错题」，并支持自动出题

### 目标信息架构

```
错题本页（左侧二级导航）
├── 习题
│   ├── 今日练习   ← 根据今天学过的知识点自动生成
│   └── 今日复习   ← 到期错题（due）+ 到期练习题
└── 错题
    ├── 今日错题   ← created_at 是今天的
    ├── 全部
    ├── 待复习 pending
    ├── 已安排 scheduled
    └── 已完成 done
```

左侧点一级项切换板块，二级项切筛选。复用现有 `mistakesApi.matchQueueFilter` 的筛选口径，不要另起一套。

### G5 后端：练习题（全新能力）

**新表** `practice_questions`：

| 字段 | 说明 |
|---|---|
| `id` | Uuid PK |
| `user_id` | FK users.id |
| `source` | `'generated'` / `'uploaded'` |
| `subject` | 学科，如「数学」 |
| `question` | 题干 |
| `answer` | 参考答案 |
| `explanation` | 解析 |
| `source_task_id` | 生成依据的 DailyTask（可空） |
| `source_mistake_id` | 由错题重出的题（可空） |
| `status` | `'pending'` / `'correct'` / `'wrong'` |
| `created_at` | 时间戳 |

**接口**（`backend/app/routers/practice.py`，新建）：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/practice?date=YYYY-MM-DD` | 当日练习题 + 当日待复习题 |
| `POST` | `/api/practice/generate` | 依据当天 `done` 的任务生成题目（LLM，需已验证 API config） |
| `POST` | `/api/practice` | 手动上传好题 |
| `PATCH` | `/api/practice/{id}/status` | 标记做对/做错 |
| `DELETE` | `/api/practice/{id}` | 删除 |

**关键联动**：`PATCH .../status` 传 `wrong` 时，**自动创建一条 `Mistake`**（把题干、我的答案带过去，`review_status='pending'`），这样「做错的练习题」直接进错题复习队列，不需要用户二次录入。

**生成逻辑**：
- 复用 `ai_proxy` 与 `NoVerifiedApiConfigError` 模式（未配置 key 时返回 400 `NO_API_KEY`，不产生副作用）。
- 输入：当天 `status='done'` 的 `DailyTask.description` + 关联 `Phase.name`；有上传资料时带 `document_service` 的摘录。
- 输出 JSON：`{"questions":[{"subject":"数学","question":"...","answer":"...","explanation":"..."}]}`，限制 5～10 题。
- 解析失败要有确定性兜底（照 `planner_service._heuristic_plan_structure` 的写法），不要让接口 500。

### G4 前端改造

- `frontend/src/pages/MistakeBookPage.tsx`：左侧加一级导航（习题 / 错题），二级筛选。当前页已用 `sessionStorage` + `studypilot:mistake-filter` 事件做跨页筛选跳转，扩展它而不是新造。
- 新增 `frontend/src/lib/practiceApi.ts`（照 `mistakesApi.ts` 风格：`apiRequest` + 显式类型）。
- 习题卡片交互：显示题干 → 「显示答案」→ 「做对了 / 做错了」。做错后提示「已加入错题本复习队列」。
- 上传入口：文本录入 + 复用 `CameraCapture.tsx` / `POST /api/mistakes/ocr` 的拍照识题链路。
- 「今日复习」直接消费错题列表的 `due: true`（后端已算好，前端不要重算时间）。

**验收**：
- 左侧能在「习题」「错题」间切换，二级筛选生效。
- 点「生成今日练习」→ 出题并落库；未配置 API key 时给出明确提示而非报错。
- 练习题标记「做错」→ 错题本「今日错题」里立刻出现。
- 自己上传的题目出现在习题列表，可被标记、可删除。

---

## 需要注意的既有约定

- `DailyTask` / `Phase` **没有 `user_id`**，归属一律经 `Plan.user_id` join 校验。
- 规划子表重建统一走 `planner_service._write_plan_structure`（先删 `DailyTask` 再删 `Phase`，FK 顺序不能反）。
- `completion_rate` 后端是 **0–100 整数**，不要当比例再乘 100。
- `PATCH /api/phases/{id}` 是纯 REST，不校验 API config。
- 新增 `PlanGenerator` 参数要同步所有测试里的 generator（4 参可注入协议）。
