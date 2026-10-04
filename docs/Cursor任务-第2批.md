# Cursor 任务说明 · 第 2 批（E0 / E1 / E2 / E3 / E4 / E5）

> 主题：**「粘贴 B 站链接 → 排进每日任务」这条链路的 5 个缺陷**。
> 全部是主人 2026-10-04 晚实测后提出的要求，每一条都附了**实测证据**（数据库查询结果 /
> 正则实测输出），照着改即可，不需要自己复现。

---

## 使用说明（先读这段）

**1. 本批一次做完**，按下面顺序（E0 是前置，必须先做）：

| 序号 | 项目 | 体量 | 风险 |
|---|---|---|---|
| 0 | E0 清工作区 + 清演示数据污染 | 10 分钟 | 低（但**必须先做**） |
| 1 | E1 链接识别（粘连文字 / 追踪参数） | 小 | 低 |
| 2 | E2 分 P 按分钟切分 + 按连续自然日铺开 | 中 | **高**（动写入逻辑） |
| 3 | E3 排任务前确认「开始时间」 | 中 | 中（新增一轮对话状态） |
| 4 | E4 「今天」统一到北京时间 | 小 | 中（全局时间基准） |
| 5 | E5 存量脏日期（五月） | 无代码 | 无 |

**2. 每完成一项，立刻 `git commit`，不要攒到最后。**
commit message 以编号开头：

```
E0: 提交并清理在飞改动与演示数据污染
E1: 链接识别拒绝粘连文字，B站链接规范化为纯净地址
E2: 视频分P按每日时长切分，按连续自然日铺开每日任务
E3: 排任务前先确认开始日期，不再默认今天
E4: 统一使用北京时间作为「今天」
```

**3. 每完成一项立刻跑测试，全做完再跑一次全量。**

```bash
cd frontend && npm run build
cd backend && .venv/Scripts/python.exe -m pytest tests -q
```

- `npm run typecheck` 是**假绿的**（走空壳 tsconfig），**不能**作为通过依据，只能看 `npm run build`。
- 后端全量约 **6~7 分钟**。2026-10-04 18:52 实测基线：**314 passed, 72 subtests passed**。
  ⚠️ 那是 `video_link` 相关测试加进来之前的数字，**你自己开工前先跑一次，以你实测的为准**，
  并且**这个数字只能变多，不能变少**。

**4. 已确认的设计决策，不用再问：**

- **E3 默认开始日**：本地时间 **≥ 20:00 → 默认次日**，否则默认当日；**但无论默认值是什么，
  都必须让用户回一句确认才写库**。
- **E4 时区实现**：用**固定 UTC+8 偏移**，不要用 `zoneinfo`（原因见 E4）。
- **E5 不改代码**，只按文档里的指引操作数据。
- **E2 允许新建 `DailyTask`**，不要为了「不新建」而去借用别的日期的任务行。

**5. 报告只需最后给一份汇总**：每项一行（改了哪些文件 + 测试结果）、commit hash、
最终全量测试输出、没做完/没把握的部分。

**6. 不要顺手改无关代码。** 不动视觉令牌、不重构没点名的组件、不升级依赖。

**7. 有既有测试被改动时，必须在汇总里单列**，说明为什么改、改成什么。

---

## E0 · 先清工作区 + 清演示数据污染（前置，必须最先做）

### 为什么

**工作区现在有约 28 项未提交改动**（`18 M` + `10 ??`），是**两个会话并行产出**的：

- 小狗（另一个会话）做的：`resource_links.py`、`TaskResourceLink.tsx`、`resourceRequest.ts`、
  迁移 `e1f2a3b4c5d6`、`DailyTask.resource_url` 等（「每日任务资源链接」闭环）。
- 本批要改的：`video_link.py`、`test_video_link.py`、迁移 `f2a3b4c5d6e7`、
  `conversation_service.py` 的 `position`、`ChatPanel.tsx` / `UserMessage.tsx` / `assistantStore.ts` 等。

**不先提交的话，你本批的改动会和这些混在一起，出问题没法单独回滚。**

另外迁移链要确认是 `e1f2a3b4c5d6 → f2a3b4c5d6e7 (head)`，
`f2a3b4c5d6e7` 的 `down_revision` 必须指向 `e1f2a3b4c5d6`（现在是对的，别改坏）。

### 怎么做

1. **先核对 `git status --porcelain` 里的每一项**，确认都是有意为之的改动（不是半成品）。
2. ⚠️ **`??` 未跟踪的新文件必须 `git add` 进去**。历史上 Cursor 只 add 自己本次改的文件、
   漏掉 untracked 新文件，导致 HEAD 不可用（迁移断链、前端 import 找不到文件）。
   本批的 `??` 至少有：`backend/app/services/resource_links.py`、`video_link.py`、
   `backend/tests/test_video_link.py`、`backend/tests/test_daily_task_resource_url.py`、
   两个迁移文件、`frontend/src/lib/resourceRequest.ts` 等。
3. **按「谁做的」拆成两个 commit**（一个提小狗那批，一个提链接那批），不要一个巨无霸 commit。
4. 提交完立刻自检两件事：
   ```bash
   git status --porcelain          # 应该干净
   git ls-tree HEAD <关键新文件路径>  # 关键新文件确实进了 HEAD
   ```
5. **验证迁移链**（不要碰真实库）：
   ```bash
   DATABASE_URL=sqlite:///./_migration_test.db ./.venv/Scripts/python.exe -m alembic upgrade head
   rm -f _migration_test.db
   ```

### 演示数据污染（必须清）

真实库 `backend/studypilot.db` 里有**测试残留**，会污染主人的演示：

| 对象 | 内容 | 问题 |
|---|---|---|
| 用户 `phaseclick01` | 无昵称 | 测试账号 |
| 计划 `click-check` | 2 个阶段 `click-phase` / `later-phase`，任务 `CLICKTASK-导数定义精读` | **它是最新的 plan** |

因为 `GET /api/plans/latest` 和 `video_link.merge_into_daily_plan` 都按
`created_at DESC` 取最新一条，所以：

- 主人打开 Roadmap / 总览，看到的是 `click-check` 这个垃圾计划，**不是**他的「武忠祥的2028高数二」。
- 粘链接排任务，也会排到 `click-check` 上去。

**处理**：先备份再删。

```bash
cd backend
cp studypilot.db studypilot.db.bak-$(date +%Y%m%d-%H%M)
# 删 click-check 计划（连同它的 phases / daily_tasks / plan_revisions）
# 删 phaseclick01 用户（连同它的所有子表数据）
```

用 SQLAlchemy 写个一次性脚本删，不要手写裸 SQL 漏掉子表。
⚠️ **`ondelete=CASCADE` 在 SQLite 上默认不生效**（`PRAGMA foreign_keys=OFF`），
必须手动先删子表再删父表，顺序：
`daily_tasks` → `phases` → `plan_revisions` → `plans`；用户再删 `conversations` → `chat_messages` 等。

删完确认 `GET /api/plans/latest` 返回的是「武忠祥的2028高数二」。

---

## E1 · 链接识别：粘连文字 + 追踪参数

### 现象（主人原话）

> 链接后面如果紧跟文字的话，它无法识别哪些是正确的链接的内容。

主人给的实际链接：

```
https://www.bilibili.com/video/BV1mr4y1K7Lb/?spm_id_from=333.1387.favlist.content.click&vd_source=cda7d1d06b24a89b41ce2b851321dfe8
```

### 根因（实测）

`backend/app/services/video_link.py:25`：

```python
_URL = re.compile(r"https?://[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+")
```

字符类包含 `A-Za-z0-9`，**没有终止条件**，所以链接后面紧跟的 ASCII 文字会被一起吞掉。
实测（用主人的链接拼不同后缀）：

| 链接后紧跟 | `extract_url` 结果 |
|---|---|
| `开始学`（中文） | ✅ 正确 |
| `请排进计划`（中文） | ✅ 正确 |
| `P1开始` | ❌ 尾部多了 `P1` |
| `from今天` | ❌ 尾部多了 `from` |
| `abc` | ❌ 尾部多了 `abc` |
| `10月5日` | ❌ 尾部多了 `10` |
| `（武忠祥）` | ✅ 正确 |

即：**中文能截断，ASCII 不能**。链接后面跟 `P1`、`from`、数字、英文时全错。

顺带：即使识别对了，存下来的也是带 `spm_id_from=...&vd_source=...` 的**脏地址**。

### 怎么做

**核心思路：对已知平台不要「猜边界」，直接规范化重建。**

`extract_bvid()`（`video_link.py:35`）已经存在，`BV[0-9A-Za-z]{10}` 精确匹配 12 个字符，
**天然不会吃掉后面的 `P1`**。所以：

1. 在 `extract_url()` 里**先试 B 站**：如果 `extract_bvid(text)` 命中，
   直接返回 `part_url(bvid, 1)`（即 `https://www.bilibili.com/video/{bvid}`）。
   → 粘连文字和追踪参数**一起解决**。
2. 非 B 站链接才走正则，并且**加边界要求**：匹配到的 URL 后面必须是
   **行尾 / 空白 / 非 ASCII 字符 / 中文标点（`，。、）】？！」`）**。
   不满足就说明「链接后面粘连了文字」，此时**不要猜**，返回 `None`，
   由上层回复一句：
   > 这个链接后面粘着文字，我没法确定地址到哪结束。麻烦单独发一条只含链接的消息。

   宁可多问一句，也不要读错页面或存错地址（这条符合 `DEPLOY.md` 的「不编造地址」立场）。
3. `part_url(bvid, page)` 保持现状（`page<=1` 不带 `?p=`，否则 `?p=N`），
   它本来就是干净地址，**不要再把原始 query 拼回去**。

### 验收

新增/补充 `backend/tests/test_video_link.py` 的用例，至少覆盖：

- `extract_url(链接 + 'P1开始')` → 返回纯净的 `https://www.bilibili.com/video/BV1mr4y1K7Lb`
- `extract_url(链接 + 'from今天')` → 同上
- `extract_url(链接 + 'abc')` → 同上
- `extract_url(链接 + ' 请排进计划')` → 同上
- `extract_url(链接 + '，然后排一下')` → 同上
- `extract_url(链接)` 结果**不含** `spm_id_from` 和 `vd_source`
- 非 B 站链接后紧跟 ASCII 文字 → `None`
- 非 B 站链接后跟中文 / 空白 / 行尾 → 正常返回

---

## E2 · 分 P 按「分钟」切分，按「连续自然日」铺开

### 现象（主人原话）

> 他给的是对应的视频的学习时间，这个是没问题，但是他是要结合最开始安排的。
> 比如说你今天应该完成哪些内容：2026-10-04 P1 26高数基础01 ——
> 10月5日应该学完哪些内容、10月6日应该学完哪些内容…直到第二个阶段 2026-10-20 P2 26高数基础02…

主人实际收到的回复（截图）：

```
按你现在的规划，把《（最新大纲版）武忠祥老师｜高等数学基础班…》里读到的内容排进从今天开始的每日任务了。
每天学到：
2026-10-04 P1 26高数基础01
2026-10-20 P2 26高数基础02
2026-11-01 P3 26高数基础03
2026-11-15 P4 武忠祥老师高数基础班完整内容、P5 27基础《严选题》01、P6 强化阶段复习要点
```

**日期是跳的（10-04 → 10-20 → 11-01 → 11-15），中间 10-05 到 10-19 全空。**

### 根因（实测，两层）

**第一层：`merge_into_daily_plan` 把「内容分组」贴到「已存在的任务行」上，而不是贴到连续日期上。**

`video_link.py:301` 起：

```python
today = date.today()
tasks = [... DailyTask.task_date >= today, status == "pending" ... order_by(task_date, id)]
groups = _pack(material["sections"], plan.daily_minutes)
for index, group in enumerate(groups):
    task = tasks[min(index, len(tasks) - 1)]   # ← 按「第几条任务」贴，不是按「第几天」
```

所以**日期的形状完全由存量任务行决定**。任务行稀疏，输出就稀疏。

**第二层：这个计划的存量任务行本来就是稀疏的（旧代码产物）。**

实测 `backend/studypilot.db` 里计划「武忠祥的2028高数二」：

- 6 个阶段日期：`2026-05-07 ~ 2026-12-31`（**比今天 2026-10-04 早 5 个月**，见 E5）
- 每日任务**总共只有 24 条**，跨 8 个月，日期为
  `05-07, 05-14, 05-28, 06-15, 06-16, 07-01, 07-20, 08-10, 08-11, 09-01, 09-20, 09-30, 10-01, 10-04, 10-20, 11-01, 11-15, 11-16, 12-01, 12-15, 12-20, 12-21, 12-25, 12-31`
- 其中 `task_date >= 2026-10-04` 的只有 7 条，前 4 条正好是
  **`10-04 / 10-20 / 11-01 / 11-15`** ← **和截图完全对上**。

**第三层：`_pack` 不会把一个长视频切成多天。**

`video_link.py:283`：

```python
def _pack(sections, daily_minutes):
    budget = max(int(daily_minutes or 0), 20) * 60
    for section in sections:
        seconds = section["duration"] or budget
        if current and used + seconds > budget:
            groups.append(current); current = []; used = 0
        current.append(section); used += seconds
```

一个 section（一个分 P）**要么整天给它、要么和别的分 P 合并**，**永远不会被拆开**。
武忠祥 26 高数基础班的 P1 时长远超 120 分钟，所以 P1 独占一天 —— 主人要的「P1 学 6 天」
自然出不来。

### 怎么做

**把「内容」先按每日预算切成「日片」，再把日片按连续自然日铺开。**

1. **改 `_pack`：允许切开单个 section。**
   对每个 section 按时长切成若干片，每片不超过 `budget`：

   ```
   budget = max(daily_minutes, 20) * 60        # 秒
   对每个 section：
       remaining = section["duration"] or budget
       while remaining > 0:
           take = min(remaining, budget)
           产出日片 {label, url, seconds: take, part_index, part_total}
           remaining -= take
   ```
   - `section["duration"]` 为 0（读不到时长）时按 **1 片**处理，不要死循环。
   - 一片的 label 要能看出进度，例如 `P1 26高数基础01（1/6）`。
   - 同一天塞得下多个片时可以合并成一条任务（保持现有「、」连接风格）。

2. **改 `merge_into_daily_plan`：按「开始日 + i」定位日期，而不是按任务数组下标。**
   ```
   for index, 片 in enumerate(日片列表):
       目标日 = 开始日 + timedelta(days=index)
       task = 该 plan 下 task_date == 目标日 且 status == "pending" 的第一条
       if task:  task.description += f" {marker}{label}"；task.resource_url = 该片链接
       else:     新建 DailyTask（见下）
   ```
   - **新建时的字段**：
     - `phase_id`：取「`start_date <= 目标日 <= end_date`」的那个 Phase；
       没有匹配就取当前阶段（`is_current=True`）；再没有就取 `phase_index` 最小的。
     - `week_label`：`f"W{目标日.isocalendar().week:02d}"`（和 `task_service.add_today_task` 一致）。
     - `status="pending"`，`resource_url` = 该片的 `part_url(bvid, page)`。
     - 建完要调 `task_service.recompute_phase_progress(session, phase)` 让阶段进度跟着更新。
   - **不要**再写 `tasks[min(index, len(tasks)-1)]` 这种兜底 —— 它会重复覆盖最后一条任务。

3. **`resource_url` 用分 P 的地址**（`part_url(bvid, page)`），这样点「打开学习资源」
   能直接跳到对应那一 P，而不是整个合集首页。

4. **幂等**：现有的 `marker = f"按《{title}》学："` 重复检测保留。
   重排同一条链接时，应该**先移除旧的 marker 片段再写新的**，否则重复粘两次会叠成一长串。

### 验收

- 新增测试：给一个 `daily_minutes=120`、`sections=[{duration: 1200}, {duration: 600}]`
  的 material，断言：
  - 生成的日片覆盖**连续日期**，`开始日, 开始日+1, 开始日+2 …`，**中间无空缺**；
  - 每天的片时长之和 **≤ budget**；
  - 存量的稀疏任务行（如 10-20、11-01）**不会**被当成「第 2 天、第 3 天」；
  - 目标日没有任务行时**会新建** `DailyTask`。
- 手工验收：清掉 E0 的污染数据 + 按 E5 重排一次规划后，重新粘主人的链接，
  回复里的日期应该是 `2026-10-04, 2026-10-05, 2026-10-06 …` **连续**的。

---

## E3 · 排任务前先确认「开始时间」

### 现象（主人原话）

> 而且现在是北京时间 21:36 了，用户今晚是多半不会学的，
> 在安排任务的时候要确认「开始时间」，不要一来就默认用户今天开始。

### 根因

`video_link.py:308`：`today = date.today()` —— 拿到链接**直接开写**，
没有任何确认环节，且默认从今天开始。晚上 21:36 粘链接，就被排到「今天」。
`assistant_service.py:295` 的 `wants_to_adopt` 分支也是**一步写入**。

### 怎么做

**拆成两轮：先「读链接 + 问开始日」，用户确认后才写。**

1. **新增一个进程内草稿存储**，仿 `app/services/plan_draft_store.py` 的写法
   （同样的 `user_id` 归属校验 + 可清空的单例）。
   建议 `app/services/video_draft_store.py`，存：
   ```
   { user_id: {material: dict, url: str, suggested_start: date, created_at: datetime} }
   ```
   同一用户再来一条新链接 → **覆盖**旧草稿。超过 30 分钟 → 过期。

2. **首次识别到链接**（`assistant_service` 里 `extract_url` 命中，且当前没有
   `wants_to_adopt` 确认意图）→ **只回复，不写库**：

   ```
   我读到了《（最新大纲版）武忠祥老师｜高等数学基础班…》，共 6 个分 P，合计约 26 小时。
   按你每天 120 分钟算，大约要 13 天。
   现在 21:36，从哪天开始？
   · 回「明天」→ 2026-10-05 开始
   · 回「今天」→ 2026-10-04 开始
   · 也可以直接说日期，比如「10月8日」
   ```

   - **默认建议**：本地时间 `>= 20:00` → 次日；否则当日。
   - 建议日要**明确写出来**（不要只说「明天」），避免歧义。

3. **用户回复确认** → 解析出开始日 → 调 `merge_into_daily_plan(..., start_date=开始日)`。

4. **新增 `parse_start_date(text, today) -> date | None`**，至少认：
   - `今天` / `就今天` → `today`
   - `明天` / `明晚` / `明天开始` → `today + 1`
   - `后天` → `today + 2`
   - `10月8日` / `10月8号` / `10-08` / `2026-10-08` → 对应日期
     （`10月8日` 缺年份时取**未来最近**的那个，即今年该日期若已过则明年）
   - `下周一` 之类**不做**，不要过度设计。

5. **`wants_to_adopt` 的现有语义要保住**：用户说「按这个学」「就按这个排」「可以」时，
   走的是「用上一条消息里的链接」。这条路径**也要经过开始日确认** ——
   如果草稿里已有 `suggested_start`，且用户回的是确认词，就用草稿的建议日写库。
   即：**「可以」= 同意建议的开始日**；「明天」= 改用明天。

6. **`merge_into_daily_plan` 增加 `start_date: date` 参数**（必填），
   内部不要再用 `date.today()`。用 E4 的 `local_today()` 作为默认值来源，但调用方必须显式传。

### 验收

- 新增 `backend/tests/test_video_start_date.py`（或并入 `test_video_link.py`）：
  - `parse_start_date('明天', date(2026,10,4))` → `2026-10-05`
  - `parse_start_date('今天', …)` → `2026-10-04`
  - `parse_start_date('10月8日', date(2026,10,4))` → `2026-10-08`
  - `parse_start_date('10月8日', date(2026,10,20))` → `2027-10-08`（跨年取未来）
  - `parse_start_date('随便', …)` → `None`
- 接口级：粘链接后**数据库不应有任何新任务**；回「明天」之后才出现，且首条 `task_date` = 次日。
- 21:00 之后粘链接，建议日必须是**次日**（用可注入的「当前时间」测，不要真的等到晚上）。

---

## E4 · 「今天」统一到北京时间

### 现象 / 根因

代码里**混用了两套「今天」**：

| 位置 | 现在用的 | 问题 |
|---|---|---|
| `planner_service.py:301` `_today_utc()` | **UTC 日期** | 北京时间 00:00–08:00 时，UTC 还是**前一天** |
| `video_link.py:308` | `date.today()`（服务器本地） | 与上面不一致 |
| `task_service.py:211 / 265 / 292` | `date.today()` | 与上面不一致 |

`_today_utc()` 被用在 4 处：`planner_service.py:360`（写进 prompt 的「今天是」）、
`:429`（兜底骨架）、`:864`（`_persist_plan`）、`:1017`（`regenerate_plan`）。

**后果**：北京时间凌晨 0~8 点生成的规划，`plan.start_date` 会**比用户的「今天」早一天**；
`_anchor_schedule` 也会把计划锚到错误的日子。这是真 bug，不只是观感问题。

### 怎么做

1. **新增 `app/core/clock.py`**：

   ```python
   from datetime import date, datetime, timedelta, timezone

   # 中国全境单一时区、无夏令时，固定 +8 即可，不需要 tzdata。
   CHINA_TZ = timezone(timedelta(hours=8))

   def local_now() -> datetime:
       return datetime.now(CHINA_TZ)

   def local_today() -> date:
       return local_now().date()
   ```

   ⚠️ **不要用 `zoneinfo.ZoneInfo("Asia/Shanghai")`。**
   本机实测（Windows + 当前 venv）会直接抛：

   ```
   ZoneInfoNotFoundError: No time zone found with key Asia/Shanghai
   ```

   因为 Windows 没有系统 tz 数据库，且 `tzdata` **没装**（`pip show tzdata` → not found）。
   要用 `zoneinfo` 就必须往 `requirements.txt` 加 `tzdata` 并安装 —— 但**没必要**，
   固定 `+8` 偏移对中国等价且零依赖。

2. **替换所有「今天」的来源**：
   - `planner_service._today_utc()` → 改名为 `_today_local()`，内部用 `local_today()`。
     （4 处调用点同步改；注意**测试里可能有引用**，`grep -rn "_today_utc" tests/` 先查。）
   - `video_link.py:308` → `local_today()`
   - `task_service.py:211 / 265 / 292` → `local_today()`

3. **`_PLAN_SYSTEM_PROMPT` 里的「今天是」**（`planner_service.py:360`）会跟着变成北京时间日期，
   这正是我们要的 —— 模型才会把任务排到用户的「今天」。

### 验收

- 新增 `backend/tests/test_clock.py`：`local_today()` 与 `datetime.now(timezone(timedelta(hours=8))).date()` 一致。
- `grep -rn "date.today()\|_today_utc" backend/app` 应该**只剩** `clock.py` 一处定义，
  其余全部走 `local_today()`。
- 全量测试不许变少（有的测试可能硬编码了 UTC 日期预期，**如果挂了要单独在汇总里说明**）。

---

## E5 · 存量脏日期（「五月」）—— 不改代码

### 现象（主人原话）

> 用户是十月四日开始的，为什么会显示五月的开始学习时间，我服了…

### 根因（已定位，**不是当前代码的 bug**）

实测 `backend/studypilot.db`，计划「武忠祥的2028高数二」（`created_at = 2026-10-04 07:49:46` UTC
= 北京时间 **15:49**）：

| 阶段 | 日期 |
|---|---|
| 1 基础恢复与诊断阶段 | **2026-05-07 ~ 2026-06-15** |
| 2 高数二强化阶段 | 2026-06-16 ~ 2026-08-10 |
| 3 强化刷题与真题衔接 | 2026-08-11 ~ 2026-09-30 |
| 4 真题精刷与专项突破 | 2026-10-01 ~ 2026-11-15 |
| 5 冲刺模考与查漏补缺 | 2026-11-16 ~ 2026-12-20 |
| 6 考前最后调整 | 2026-12-21 ~ 2026-12-31 |

`plan.start_date` 本身是对的（`2026-10-04`），但**阶段和任务全部落在 5 月 ~ 12 月**，
最早比今天早 150 天。

**原因**：修正这类日期的两个函数 —— `_anchor_schedule`（把早于今天的排期整体后移到今天）
和 `_cover_phase_days`（补全阶段内缺失的每一天）—— 是在提交 `9f4ac91`（**今天 18:11**，
B1 批次）才加进 `planner_service.py` 的。

而这个计划建于 **15:49**，**比修复早 2 小时 22 分钟**，所以走的是旧代码，没被修正过。

实测验证：把存量的 `2026-05-07` 喂给现在的 `_anchor_schedule(..., date(2026,10,4), date(2026,12,31))`，
输出是 `2026-10-04`（正确后移 150 天）。**函数本身是好的，只是没跑在这份旧数据上。**

### 怎么做（不用改代码）

1. **让主人重新生成一次规划**：在助手里说一句「按今天重排一遍」，
   触发 `POST /api/plans/{plan_id}/regenerate` → 走 `_write_plan_structure` →
   `_anchor_schedule` + `_cover_phase_days` 生效，阶段日期会锚到 2026-10-04，
   并且每个阶段内的**每一天**都会补上任务（不再只有 24 条）。
   - 旧版本会先进 `plan_revisions` 快照（B1 已实现），**不会丢**。
2. **顺手确认 `start_date`**：重排后 `GET /api/plans/latest` 的 `startDate` 应为 `2026-10-04`。
3. **可选（如果主人希望保留这份计划而不是重排）**：写一个一次性脚本
   `backend/scripts/refit_plan_dates.py`，对指定 plan 调 `_anchor_schedule` + `_cover_phase_days`
   并回写。**默认不做**，先问主人。

### 汇报

E5 **没有代码改动**。在汇总里写清：这是 18:11 之前的旧代码产出的存量数据，
建议主人重新生成一次规划；如果他希望保留原计划再单独提。

---

## 附：本批涉及的文件清单

**要改**
- `backend/app/services/video_link.py`（E1 / E2 / E3 主战场）
- `backend/app/services/assistant_service.py`（E3 的两轮对话分支）
- `backend/app/services/planner_service.py`（E4 时间基准）
- `backend/app/services/task_service.py`（E4 时间基准）
- `backend/tests/test_video_link.py`（E1 / E2 用例）

**要新建**
- `backend/app/services/video_draft_store.py`（E3）
- `backend/app/core/clock.py`（E4）
- `backend/tests/test_clock.py`（E4）

**只读参考（不要改）**
- `backend/app/services/plan_draft_store.py` —— 草稿存储的写法范本
- `backend/app/services/resource_links.py` —— 链接白名单，`resource_url` 只存白名单内的地址
- `backend/app/services/planner_service.py` 的 `_anchor_schedule` / `_cover_phase_days`
