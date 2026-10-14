# StudyPilot 数据 Schema

> 版本 1.0.0 · 2026-10-13
>
> 本文件定义 `data/courses.json`（课程库）与 `data/jobs.json`（岗位库）的字段含义。
> 两个文件都是**静态 JSON，手工整理，随仓库提交**，不依赖任何爬虫或网络接口。

校验：`node scripts/validate-data.mjs`

---

## 为什么是静态 JSON

1. **评委冷机 10 分钟复现**——任何网络依赖都会让复现失败。
2. **可追溯**——每条数据带来源平台、链接、整理日期，答辩时可查。
3. **合规**——只收录元数据（课程名、章节标题、链接），不收录正文。

**严禁**：把爬虫脚本放进仓库；把未标记为合成的采集数据当真实数据演示。

---

## `courses.json`

### 顶层

| 字段 | 类型 | 说明 |
|---|---|---|
| `meta` | object | 版本、整理日期、来源平台、核验等级定义 |
| `meta.verification_levels` | object | 四个等级的**含义必须在文件里写明**，避免误用 |
| `directions` | array | 就业方向列表 |

### `directions[]`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 方向唯一标识，**必须与 `jobs.json` 中同方向的 id 一致** |
| `name` | string | 显示名 |
| `description` | string | 一句话说明该方向做什么、适合谁 |
| `skills` | string[] | 该方向的技能全集（各课程 skills 的并集） |
| `courses` | array | 课程列表 |

### `directions[].courses[]`

| 字段 | 类型 | 说明 |
|---|---|---|
| `course_id` | string | 唯一标识，建议 `ai-fin-001` 这种前缀式 |
| `name` | string | 课程名 |
| `institution` | string \| null | 开课机构 |
| `provider` | string | 出处平台，会直接展示给用户 |
| `instructor` | string \| null | 主讲人 |
| `url` | string \| null | 课程页链接 |
| `url_verified` | boolean | **链接是否实际打开核对过** |
| `hours` | number \| null | 学时 |
| `level` | string | 入门 / 进阶 |
| `prereq` | string[] | 前置课程的 `course_id` |
| `skills` | string[] | 该课程能覆盖的技能标签 |
| `verified` | string | 见下方核验等级 |
| `verified_note` | string | **说明这个等级是怎么来的**，人工必填 |
| `source_url` | string \| null | 章节信息的来源页 |
| `collected_at` | string | `YYYY-MM-DD` |
| `chapters` | array | 章节 |

### `chapters[]`

| 字段 | 类型 | 说明 |
|---|---|---|
| `index` | number | 章序号，从 1 开始 |
| `title` | string | 章标题 |
| `sections` | string[] | 节标题。**空数组合法**（只拿到模块级），但路线无法精确到节 |

### 核验等级 `verified`

| 值 | 含义 | 能否演示 |
|---|---|---|
| `outline_published` | 平台公开大纲，章节标题逐条可查 | ✅ |
| `textbook_toc` | 来自配套教材公开目录，与线上章节可能不一致 | ⚠️ 需说明 |
| `partial` | 只有模块级标题，未拿到节级 | ⚠️ 需补 |
| `pending` | 未核实 | ❌ |

**规则**：`partial` 和 `pending` 的记录，校验脚本会警告但**不拦截**——因为不完整比造假好。但**演示路径上不得出现 `pending`**。

---

## `jobs.json`

### 顶层

| 字段 | 类型 | 说明 |
|---|---|---|
| `meta.verification` | string | 全库默认核验状态 |
| `meta.known_limitation` | string | **必须写明数据的已知局限** |
| `meta.replace_before_submission` | string[] | 提交前的替换步骤清单 |
| `directions[].jobs` | array | 岗位列表 |

### `directions[].jobs[]`

| 字段 | 类型 | 说明 |
|---|---|---|
| `job_id` | string | 唯一标识 |
| `title` | string | 岗位名 |
| `company_type` | string | 公司类型（**不写具体公司名**，避免时效性问题） |
| `city` | string[] | 城市 |
| `seniority` | string | 应届 / 初级 / 中级 |
| `education` | string | 学历要求 |
| `major_pref` | string[] | 专业偏好 |
| `skills_required` | string[] | **硬性技能——差距分析的主输入** |
| `skills_preferred` | string[] | 加分技能 |
| `source_platform` | string \| null | 来源平台 |
| `source_url` | string \| null | 原始链接 |
| `collected_at` | string \| null | 采集日期 |
| `verification` | string | `collected` = 真实采集；`synthetic_from_curriculum` = 合成 |

### `verification` 的约束

- `collected` 时，`source_platform` / `source_url` / `collected_at` **三者必填**，否则校验报错。
- `synthetic_from_curriculum` 的记录是**为了让流水线先跑通**而依据课程技能标签推导的，**不是真实招聘信息**。演示时必须替换或移除。

---

## 技能标签对齐（最容易出错的地方）

```
课程库的 skill 集合  ⊇  岗位库的 skills_required ∪ skills_preferred
```

**反例（当前存在）**：岗位要求 `SQL` / `Excel`，但课程库里没有任何课标了这两个技能 → 方向推荐会告诉用户"你缺 SQL"，路线生成却找不到课来补，**闭环断裂**。

校验脚本对每个无法匹配的技能标签发警告。修法二选一：
1. 补一门覆盖该技能的课（推荐——SQL 和 Excel 对财务数据分析岗位是刚需）
2. 从岗位记录中删掉该技能（仅当它确实不是硬性要求时）

---

## 新增方向 / 课程的检查清单

- [ ] `direction.id` 在两个文件中一致
- [ ] `course_id`、`job_id` 全局唯一
- [ ] 每条记录填了 `verified` / `verification`
- [ ] 填了 `verified_note` 说明来源
- [ ] 技能标签能在课程库与岗位库之间对齐
- [ ] `node scripts/validate-data.mjs` 通过，且新增警告都已评估
- [ ] 演示路径无 `pending`、无 `synthetic`
