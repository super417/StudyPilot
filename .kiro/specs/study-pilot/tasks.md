# Implementation Plan: StudyPilot

## Overview

本实现计划将 `design.md` 的设计拆解为可增量执行的编码任务，严格按用户指定的五个阶段推进（顺序：先静态 UI → 动效组件库 → 逐页注入动效 → 性能调试，再进入后端与 AI 逻辑）：

- **第一阶段**：前端脚手架（React + Vite + Tailwind）、主题系统、Tab 导航与四大页面静态 UI（mock 数据 + 响应式）。本阶段产出**全静态 UI**，不做任何动效。
- **第二阶段**：交互动效（Framer Motion）—— 先实现 Motion Library 动效组件库（FadeIn/Magnet/AnimatedText/StickyStack/ScrollProgressBar），再按页面逐个注入高级动效，最后进行性能优化与 60fps 调试。
- **第三阶段**：AI 助手悬浮窗（拖拽/边界钳制/resize 重钳/弹窗/Zustand 跨组件唤起/打字机 mock 流）。
- **第四阶段**：后端骨架（FastAPI + SQLAlchemy + Alembic + SQLite）、9 张表、.env 配置、认证会话、API 配置增删改查（AES-256-GCM）。
- **第五阶段**：AI 逻辑打通（Ai_Proxy/SSE、Planner 追问状态机、文档解析切块、文档驱动规划、规划修改、任务状态联动、打卡、指标、周报、错题本），并将前端接入真实接口。

技术栈：前端 React 18 + Vite + TypeScript + Tailwind + Zustand；后端 Python 3.11 + FastAPI + SQLAlchemy 2.x + Alembic + cryptography + passlib + httpx + pydantic-settings。

动效技术栈：**Framer Motion**（framer-motion ^12.38.0）+ lucide-react ^0.344.0。

属性测试：后端用 **Hypothesis**，前端纯逻辑（含动效纯函数：Magnet 位移、StickyStack 缩放、FadeIn 默认参数、AnimatedText 不透明度映射）用 **fast-check**，每个属性至少 **100** 次迭代，测试注释统一格式 `Feature: study-pilot, Property N: ...`。带 `*` 的子任务为可选测试任务，可跳过以求更快 MVP。

---

## Tasks

### 第一阶段：前端脚手架与四大页面静态 UI

- [x] 1. 搭建前端项目脚手架与 Tailwind 主题
  - [x] 1.1 初始化 React + Vite + TypeScript 项目
    - 用 Vite 创建 `frontend/` 项目（react-ts 模板），配置 `tsconfig`、ESLint/Prettier
    - 建立目录结构：`src/pages`、`src/components`、`src/store`、`src/mocks`、`src/lib`
    - _Requirements: 14.1_

  - [x] 1.2 配置 Tailwind 主题（视觉设计系统）
    - 安装并初始化 Tailwind；在 `tailwind.config.js` 的 `theme.extend` 定义颜色（bg 浅灰、card 纯白、mint/mintDark 薄荷绿、ink 黑底、purple 紫环、danger 红）、`borderRadius.card = 1.5rem`、`boxShadow.card` 极浅阴影
    - 建立全局样式：浅色模式、浅灰背景、纯白大圆角卡片基类
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 2. 搭建全局布局：Header、Tab 导航与页面路由骨架
  - [x] 2.1 实现 Header 组件
    - 左上圆形序号 + 目标标题/副标题，右上「本地学习中 / 学习者」状态
    - 采用大字号标题、突出数字的信息层级
    - _Requirements: 12.6, 12.7_

  - [x] 2.2 实现顶部居中 Tab 导航与页面容器
    - 顶部居中 4 个 Tab：总览 / Roadmap / 错题本 / 本周复盘，按 Tab 切换渲染对应页面
    - 建立 App 顶层容器与页面路由骨架（本阶段无会话守卫，占位即可）
    - _Requirements: 12.5_

- [x] 3. 建立 mock 数据层
  - [x] 3.1 定义前端数据类型与 mock 数据
    - 在 `src/mocks` 定义 Plan/Phase/DailyTask/CheckIn/Mistake/WeeklyReview/UserDocument/Metrics 的 TS 类型与示例 mock 数据
    - 提供 mock 取数函数（后续第四阶段替换为真实接口调用）
    - _Requirements: 4.2, 5.2, 6.3, 7.3_

- [x] 4. 实现总览页（Overview）静态 UI
  - [x] 4.1 实现 GoalCard（目标卡片 + 环形进度）
    - 展示目标大标题、副标题与「备考时间流逝百分比」环形进度条（mock 值）
    - 环形值口径注释：`(today - start_date)/(goal_date - start_date)×100`，clamp 0-100
    - _Requirements: 4.1, 12.7_

  - [x] 4.2 实现 MetricsRow、WeekCalendar
    - 展示剩余天数、累计打卡分钟、连续打卡天数、阶段进度（x/7）四项指标（mock）
    - 底部横向滚动本周日历并标注当天
    - _Requirements: 4.2, 4.3_

  - [x] 4.3 实现 TodayTaskCard 与 CheckInForm
    - 绿底任务卡片：今日日期 + 今日三态（未反馈/已安排/已完成）+「开始今天的学习」按钮
    - 打卡表单：60/75/90 分钟快捷选项 + 实际学习分钟 + 难度(1-5) + 精力(1-5) + 备注
    - _Requirements: 4.4, 4.5, 4.6_

- [x] 5. 实现 Roadmap、错题本、本周复盘页静态 UI
  - [x] 5.1 实现 RoadmapPage
    - 顶部标题「全线阶段路线图 / 你的路线，正在跟着你变化」+ 最近更新时间戳
    - 横向排列阶段 1-7 进度卡片（名称/日期范围/进度%），当前阶段高亮
    - 卡片下方按周（W38/W47）分组展示周任务详情
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 5.2 实现 MistakeBookPage（左右分栏）
    - 左栏错题列表 + 待复习数量角标；右栏错题详情
    - 原题卡（深墨绿底白字）、我的答案卡（浅红底）、正确理解卡（浅绿底）、为什么错卡、复习安排状态
    - 底部「回到学习助手重新做一道」按钮（本阶段占位，唤起真实 AI 助手悬浮窗为后续任务）
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 5.3 实现 WeeklyReviewPage
    - 未满一周空状态提示文案；右上紫色环形图（知识掌握平均值）
    - 累计投入/连续天数/任务完成率三项数据卡；各科目掌握度进度条明细
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 6. 实现响应式布局
  - [x] 6.1 应用 grid/flex 响应式断点
    - 用 Tailwind `grid`/`flex` 让四大页面在 `lg:` 大屏多列、默认（手机）单列（如 `grid-cols-1 lg:grid-cols-3`）
    - _Requirements: 13.1, 13.2, 13.3_

  - [ ]* 6.2 编写视觉系统与响应式快照测试
    - 用 Vitest + Testing Library 验证主色类（mint）、黑底白字、紫色环形图、大圆角类的出现
    - 验证断点下多列/单列结构（需求 12、13）
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 13.2, 13.3_

- [x] 7. 第一阶段收尾 - 运行并手动测试
  - 本地运行前端开发服务器，逐页核对四大页面静态 UI 与响应式（大屏多列/手机单列）
  - 运行前端单元/快照测试，确保全部通过
  - **提醒用户**：请在浏览器中打开前端，检查配色、Tab 切换、四大页面视觉与手机窗口下的单列折叠；确认无误后再进入第二阶段。若有视觉调整需求请提出。

---

### 第二阶段：交互动效（Framer Motion）

> 顺序强制：本阶段在第一阶段全静态 UI（任务 1-7）之后进行。先安装依赖 → 实现 Motion Library 组件库（任务 24-25）→ 按页面逐个注入高级动效（任务 26-30）→ 最后性能优化与 60fps 调试（任务 31）→ 阶段收尾（任务 32）。

- [x] 24. 安装动效依赖
  - 更新 `frontend/package.json` 加入 `framer-motion` `^12.38.0` 与 `lucide-react` `^0.344.0`，执行安装
  - _Requirements: 18.1_

- [x] 25. 实现 Motion Library 动效组件库（`frontend/src/components/motion/`）
  - [x] 25.1 实现 FadeIn（通用入场）
    - 用 `motion.create()` 创建包裹组件；`whileInView` + `viewport={{ once: true, margin: '50px', amount: 0 }}` 触发一次入场，后续可见性变化不重复播放
    - 支持 `delay`/`duration`/`x`/`y` props；默认 `duration=0.7`、`ease=[0.25,0.1,0.25,1]`
    - _Requirements: 18.1, 18.2, 18.3_

  - [x] 25.2 实现 Magnet（磁吸按钮）
    - 元素外扩 `padding=150px` 范围触发；位移 = 光标相对元素中心的偏移 / `strength`(默认 3)，用 `translate3d`
    - 进入 0.3s ease-out 执行位移、离开 0.6s ease-in-out 复位；设置 `willChange: transform`
    - _Requirements: 18.4, 18.5, 18.6_

  - [x] 25.3 实现 AnimatedText（滚动显字）
    - 用 `useScroll` 以 `offset: ['start 0.8', 'end 0.2']` 驱动进度；字符 opacity 从 0.2→1 逐字过渡
    - 采用不可见占位符（撑开排版）+ 绝对定位动画层，保持排版位置不变
    - _Requirements: 18.7, 18.8_

  - [x] 25.4 实现 StickyStack（粘性堆叠）
    - 各卡片 `position: sticky`、`top = 24px`，第 index 张 `targetScale = 1 − (totalCards − 1 − index) × 0.03`、`top = index × 28px`
    - _Requirements: 18.9_

  - [x] 25.5 实现 ScrollProgressBar（顶部滚动进度条）
    - 顶部固定薄荷绿色细进度条；`useScroll` 进度驱动 `scaleX`
    - _Requirements: 18.26_

  - [x]* 25.6 编写 Magnet 位移公式属性测试（fast-check）
    - **Property 23: Magnet 位移公式正确性**
    - **Validates: Requirements 18.4**
    - 注释 `Feature: study-pilot, Property 23`，≥100 次迭代
    - _Requirements: 18.4_

  - [x]* 25.7 编写 StickyStack 缩放公式属性测试（fast-check）
    - **Property 24: StickyStack 缩放公式正确性**
    - **Validates: Requirements 18.9**
    - 注释 `Feature: study-pilot, Property 24`，≥100 次迭代
    - _Requirements: 18.9_

  - [x]* 25.8 编写 FadeIn 默认参数属性测试（fast-check）
    - **Property 25: FadeIn 参数与默认值**
    - **Validates: Requirements 18.2, 18.3**
    - 注释 `Feature: study-pilot, Property 25`，≥100 次迭代
    - _Requirements: 18.2, 18.3_

  - [x]* 25.9 编写 AnimatedText 不透明度属性测试（fast-check）
    - **Property 26: AnimatedText 字符不透明度随进度单调**
    - **Validates: Requirements 18.7**
    - 注释 `Feature: study-pilot, Property 26`，≥100 次迭代
    - _Requirements: 18.7_

- [x] 26. 向 Overview 页注入动效（依赖：任务 4 静态 UI + 任务 25 Motion Library）
  - 背景色随滚动 `useScroll` → `useTransform` 在浅灰与极浅薄荷绿间过渡
  - 主卡片 `FadeIn(delay=0.15, y=40)` 入场，卡内数字与环形进度用 spring 弹性呈现
  - 本周日历第 i 张以 `i × 0.05` 秒延迟交错入场；主卡片随滚动施加视差位移
  - 每日任务卡片列表用 `StickyStack`；「开始今天的学习」按钮用 `Magnet` 包裹
  - _Requirements: 18.9, 18.10, 18.11, 18.12, 18.13, 18.4_

- [x] 27. 向 Roadmap 页注入动效（依赖：任务 5.1 静态 UI + 任务 25 Motion Library）
  - 垂直错落布局 + 左侧超大数字；第 i 个阶段列表项以 `i × 0.1` 秒延迟交错入场
  - 当前阶段薄荷绿高亮、其余白底；hover 时卡片右移并加深阴影
  - _Requirements: 18.14, 18.15, 18.16_

- [x] 28. 向 MistakeBook 页注入动效（依赖：任务 5.2 静态 UI + 任务 25 Motion Library）
  - 左侧列表项 hover 浮起 + 选中项薄荷绿指示条
  - 切换错题时用 `AnimatePresence`：旧详情淡出并上移退场、新详情以 `y=20` 淡入；新详情内原题/我的答案/正确理解卡片以 0.1/0.2/0.3 秒延迟依次淡入
  - 「回到 AI 助手悬浮窗重新做一道」按钮用 `Magnet` 包裹
  - _Requirements: 18.17, 18.18, 18.4_

- [x] 29. 向 WeeklyReview 页注入动效（依赖：任务 5.3 静态 UI + 任务 25 Motion Library）
  - 数据指标卡片进入视口交错入场
  - 知识掌握环形图用 SVG `pathLength` 从 0 绘制到实际进度值
  - 顶部提示文字用 `AnimatedText` 滚动显字
  - _Requirements: 18.19, 18.20, 18.21_

- [x] 30. 注入全局动效（依赖：任务 2.2 Tab 容器 + 任务 25 Motion Library）
  - `App` 顶层挂载 `ScrollProgressBar`
  - Tab 切换时页面内容用 `AnimatePresence` 淡入并向上滑动进出场
  - _Requirements: 18.26, 18.27_

- [x] 31. 性能优化与 60fps 调试（依赖：任务 26-30 动效注入完成）
  - 长列表（如错题本）采用 `whileInView` 视口内渲染或 `content-visibility: auto`；参与动画元素设置 `will-change: transform`
  - 用浏览器 DevTools 手动观察滚动帧率，确认约 60fps；确认全部动效不破坏需求 12（浅色/薄荷绿/圆角/极浅阴影）与需求 13（响应式栅格）
  - 说明：本任务含手动帧率观察与视觉/响应式核对，属手动验证
  - _Requirements: 18.28, 18.29_

- [x] 32. 第二阶段收尾 - 运行并手动测试
  - 运行前端 `typecheck`/`lint`/`build` 与 fast-check 属性测试（Property 23-26），确保全部通过
  - 本地运行前端开发服务器，逐页手动核对：FadeIn 入场只播一次、Magnet 磁吸吸附与复位、AnimatedText 滚动显字、StickyStack 堆叠、Overview 背景过渡/视差/日历交错、Roadmap hover、MistakeBook 详情切换、WeeklyReview 环形绘制、顶部进度条与 Tab 切换动画
  - **提醒用户**：请在浏览器中滚动各页、悬停核心按钮、切换错题与 Tab，确认动效顺滑且不破坏原有配色/圆角/响应式；确认无误后进入第三阶段。

---

### 第三阶段：AI 助手悬浮窗

- [x] 8. 建立 Zustand 全局状态与 AI 助手悬浮窗上下文
  - [x] 8.1 实现 AppStore（Zustand）
    - 定义 `assistant` 状态：open、position、context、messages、streaming
    - 实现 actions：`openAssistantWithContext(ctx)`（打开+覆盖上下文+保留历史）、`appendStreamChunk`、`stopStreaming`
    - _Requirements: 8.7, 8.10, 8.11, 6.6_

  - [x] 8.2 实现边界钳制纯函数 clampIconPosition
    - 纯函数：给定目标位置与视口尺寸，返回 `x=clamp(x,0,W-iconW)`、`y=clamp(y,0,H-iconH)`，取最近合法点
    - _Requirements: 8.3, 8.4, 8.5_

  - [x]* 8.3 编写 AI 助手悬浮窗状态与钳制的属性测试（fast-check）
    - **Property 10: 拖拽/resize 后图标恒在视口内**
    - **Validates: Requirements 8.3, 8.4, 8.5**
    - **Property 11: 会话历史保留与上下文覆盖**
    - **Validates: Requirements 8.7, 8.10, 8.11, 6.6**
    - 每个属性单独用例，注释 `Feature: study-pilot, Property 10/11`，≥100 次迭代
    - _Requirements: 8.3, 8.4, 8.5, 8.7, 8.10, 8.11, 6.6_

- [x] 9. 实现 AI 助手悬浮窗组件
  - [x] 9.1 实现 FloatingIcon（定位 + 拖拽 + 钳制 + resize 重钳）
    - 容器 `position: fixed`、`z-index: 9999`，初始右下角距边界各 24px，不随滚动移动
    - `pointerdown/move/up` 拖拽，move 时实时调用 `clampIconPosition`
    - 监听 `window.resize`（≤500ms 防抖）触发重钳
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 9.2 实现 ChatWindow 弹窗与打字机渲染（mock 流）
    - 点击图标 ≤300ms 弹出窗口并约束在视口内完整可见
    - 消息列表 + 输入框；打字机逐字符渲染，先用 mock 流（setInterval 模拟 token）
    - 中断/停止：保留已接收内容、显示错误提示、不清空历史
    - _Requirements: 8.6, 8.7, 8.8, 8.9_

  - [x] 9.3 接入跨组件唤起
    - 将错题详情「回到 AI 助手悬浮窗重新做一道」按钮接 `openAssistantWithContext`，注入错题上下文
    - 再次点击注入新上下文时覆盖 context、保留 messages
    - _Requirements: 6.6, 8.10, 8.11_

  - [x] 9.4 注入 AI 助手悬浮窗动效（依赖：9.1/9.2 组件就绪 + 任务 25 Motion Library）
    - 展开时用 spring 弹性动画从 `scale 0.8` 弹入至 `scale 1`
    - 新消息进入用 `AnimatePresence` 以 `y=20` 淡入入场
    - 输入框聚焦时呈现边框微光效果
    - 用 `drag` + `dragConstraints` 将悬浮窗位置限制在视口可视区域内（与 8.3-8.5 钳制一致）
    - 悬浮窗图标用 `Magnet` 包裹
    - _Requirements: 18.22, 18.23, 18.24, 18.25, 18.4_

- [x] 10. 第三阶段收尾 - 运行并手动测试
  - 本地运行前端，验证：图标固定悬浮不随滚动移动、可拖拽且不超出视口、缩放窗口后自动回钳、点击弹窗、mock 打字机渲染、从错题详情唤起并带入上下文；核对 AI 助手悬浮窗动效（spring 弹入、消息淡入、输入框微光、drag 约束、图标磁吸）
  - 运行 fast-check 属性测试（Property 10、11）确保通过
  - **提醒用户**：请手动拖拽 AI 助手悬浮窗到四个角与屏幕外、缩放浏览器窗口、从错题页唤起，确认行为符合预期后进入第四阶段。

---

### 第四阶段：后端骨架、认证与 API 配置

- [x] 11. 搭建后端项目、配置管理与数据库骨架
  - [x] 11.1 初始化 FastAPI 项目与 .env 配置管理
    - 建立 `backend/` 项目：FastAPI + Uvicorn，目录 `app/{routers,services,models,core}`
    - 用 `pydantic-settings` 的 Settings 加载 `.env`：`DATABASE_URL`、`DB_PASSWORD`、`AES_KEY`(Base64 32B)、`SESSION_TIMEOUT_MINUTES`
    - 提供 `.env.example`，将 `.env` 加入 `.gitignore`；源码禁止硬编码密码/密钥
    - _Requirements: 14.2, 14.4, 14.5_

  - [x] 11.2 配置 SQLAlchemy + Alembic（SQLite 开发）
    - 建立 SQLAlchemy 2.x engine/session（DATABASE_URL 指向 SQLite 开发库）
    - 初始化 Alembic 迁移环境
    - _Requirements: 14.3, 11.1_

  - [x] 11.3 定义 9 张表的 ORM 模型
    - Users、Api_Configs、Plans、Phases、Daily_Tasks、Check_Ins、Mistakes、Weekly_Reviews、User_Documents（字段与约束按 design.md Data Models）
    - User_Documents 加 `(doc_id, chunk_index)` 唯一约束；生成初始 Alembic 迁移
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 12. 实现 Crypto 模块与密码哈希
  - [x] 12.1 实现 AES-256-GCM Crypto 模块
    - `encrypt(plain)`：12B 随机 IV，落库格式 `base64(IV||ciphertext||tag)`；`decrypt(cipher)` tag 校验失败即抛错
    - 密钥来自 Settings.AES_KEY，禁止硬编码
    - _Requirements: 2.8, 14.6_

  - [x]* 12.2 编写 AES 往返属性测试（Hypothesis）
    - **Property 4: API Key AES 加解密往返**（密文不含明文子串且 decrypt(encrypt(k))==k）
    - **Validates: Requirements 2.8, 2.9, 11.4, 14.6**
    - 注释 `Feature: study-pilot, Property 4`，≥100 次迭代
    - _Requirements: 2.8, 2.9, 11.4, 14.6_

- [x] 13. 实现 Auth_Service：注册/登录/会话/锁定
  - [x] 13.1 实现注册（校验 + bcrypt 加盐哈希）
    - 校验 username(3-64)/password(8-128)，非法拒绝且不建记录；标识占用返回 409
    - passlib bcrypt 存 `password_hash`，禁止明文
    - _Requirements: 1.1, 1.2, 1.3, 1.10_

  - [x] 13.2 实现登录、失败计数与锁定
    - 凭证匹配建会话并清零失败计数；不匹配失败计数 +1
    - 连续失败达 5 次锁定 15 分钟，锁定期拒绝并返回剩余秒数
    - _Requirements: 1.4, 1.5, 1.6_

  - [x] 13.3 实现会话 30 分钟超时与登录后数据加载（含降级）
    - 每次请求刷新 `last_active_at`，`now - last_active_at > 30min` 终止会话要求重登
    - 登录后加载该用户 API 配置与历史数据；加载失败保持已认证、返回降级提示、允许无历史继续
    - `/api/auth/{register,login,logout,me}` 路由接线
    - _Requirements: 1.7, 1.8, 1.9_

  - [x]* 13.4 编写认证属性测试（Hypothesis）
    - **Property 1: 密码哈希往返**（存储 hash≠明文，verify 正确/错误分别真/假）
    - **Validates: Requirements 1.10, 1.1**
    - **Property 2: 非法注册一律拒绝且不改动数据**（用户总数不变）
    - **Validates: Requirements 1.2, 1.3**
    - **Property 3: 登录失败连续 5 次触发锁定**（15 分钟内锁定，成功登录计数归零）
    - **Validates: Requirements 1.6, 1.4, 1.5**
    - 每个属性单独用例，注释 `Feature: study-pilot, Property 1/2/3`，≥100 次迭代
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.10_

  - [x]* 13.5 编写会话超时单元测试
    - 注入可控时钟测 <30min 有效、>30min 失效
    - _Requirements: 1.7_

- [x] 14. 实现 Api_Config_Service：增删改查与验证
  - [x] 14.1 实现 Base URL 校验与 API Key 掩码
    - Base URL 必须以 http:// 或 https:// 开头（前后端一致校验）
    - 掩码函数：仅暴露后 4 位，其余掩码符
    - _Requirements: 2.2, 2.3, 2.10_

  - [x] 14.2 实现配置保存（验证 + AES 加密入库）
    - 提交后先做一次测试调用验证（10s 超时）：超时/错误不标记可用；通过则 AES 加密 api_key 入库并标记 is_verified
    - 拒绝明文写库（统一经 Crypto.encrypt）
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 14.3 实现配置查询/更新/删除与无有效配置拦截
    - GET 返回掩码配置；PUT/PATCH 验证通过后覆盖原记录并重新加密；DELETE 删除记录
    - 无 `is_verified=true` 配置时发起 AI 操作在路由层返回 `NO_API_KEY`
    - `/api/api-config` 路由接线
    - _Requirements: 2.11, 2.12, 2.13_

  - [x]* 14.4 编写 API 配置属性测试（Hypothesis / fast-check）
    - **Property 5: API Key 掩码仅暴露后 4 位**（Hypothesis）
    - **Validates: Requirements 2.10**
    - **Property 6: Base URL 格式校验一致性**（前端 fast-check）
    - **Validates: Requirements 2.3**
    - 注释 `Feature: study-pilot, Property 5/6`，≥100 次迭代
    - _Requirements: 2.3, 2.10_

  - [x]* 14.5 编写配置验证与增删改单元测试
    - mock 外部返回覆盖验证成功/超时/错误三种；更新后读回为新配置、删除后记录不存在；无有效配置发起 AI 被拒
    - _Requirements: 2.4, 2.5, 2.6, 2.11, 2.12, 2.13_

- [x] 15. 第四阶段收尾 - 运行并手动测试
  - 运行 Alembic 迁移建库，启动后端；用 HTTP 客户端手动测注册/登录/锁定/超时、API 配置增删改查与掩码
  - 运行后端属性测试与单元测试，确保全部通过；确认数据库中 api_key 为密文、无明文
  - **提醒用户**：请确认 `.env` 已正确配置（AES_KEY/DATABASE_URL），并手动验证登录失败锁定与配置掩码后进入第五阶段。

---

### 第五阶段：AI 逻辑打通与前端接入真实接口

- [x] 16. 实现 Ai_Proxy 与 SSE 流式代理
  - [x] 16.1 实现凭证内存解密与出站无凭证保证
    - Ai_Proxy 读取用户加密 Key、经 Crypto 解密仅存内存局部变量；解密失败终止外呼返回 CRED_UNAVAILABLE；无 Key 记录返回 NO_API_KEY
    - 响应体/响应头/错误信息均不含凭证；前端出站请求体不含任何 Key 字段
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 16.2 实现 SSE 流式转发、30s 首块超时与中断
    - httpx 异步流式调用外部 AI，`StreamingResponse` 转发 token/error/done 事件
    - `asyncio.wait_for` 对首块设 30s 超时→推 error 并关闭；检测客户端断开即停外呼、释放资源
    - _Requirements: 3.6, 3.8, 3.9_

  - [x]* 16.3 编写凭证不外泄属性测试与 SSE 单元测试
    - **Property 7: 出站请求与代理响应不含凭证**
    - **Validates: Requirements 3.1, 3.2, 3.3, 14.7**
    - 注释 `Feature: study-pilot, Property 7`，≥100 次迭代
    - 单元测试：首块超时、断连处理、解密失败/无 Key 分支（mock 外部）
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.8, 3.9, 14.7_

- [x] 17. 实现文档上传、解析与切块
  - [x] 17.1 实现文档解析与文本切块
    - 接收 multipart（≤20MB），按 pdf/docx/txt/md 解析文本；不支持格式返回 UNSUPPORTED_TYPE(415)
    - 切块：每块 ≤1000 字符、相邻块重叠 200 字符；解析失败/空文本返回 PARSE_FAILED(422) 且不写部分数据
    - 全部 chunk 及 doc_id 存入 User_Documents（chunk_index 从 0 连续递增）
    - `POST /api/documents` 路由接线
    - _Requirements: 11.5, 11.6, 11.7, 11.8, 11.9_

  - [x]* 17.2 编写文档切块属性测试（Hypothesis）
    - **Property 15: 文本切块正确性与覆盖完整原文**（≤1000、重叠 200、去重叠拼接还原、chunk_index 连续）
    - **Validates: Requirements 11.6, 11.7**
    - **Property 16: 解析失败/空文本的写入原子性**（不新增任何 chunk 行）
    - **Validates: Requirements 11.9, 11.8**
    - 注释 `Feature: study-pilot, Property 15/16`，≥100 次迭代
    - 见 `tests/test_mistake_document_properties.py`
    - _Requirements: 11.6, 11.7, 11.8, 11.9_

- [x] 18. 实现 Planner 规划生成与三轮追问状态机
  - [x] 18.1 实现追问状态机与规划生成
    - 解析必填字段（目标名称/日期/当前水平/每日时长）；缺失则追问并精确指明缺失字段
    - 追问计数绑定单目标，`round>=3` 强制生成并提示；`round<3` 且信息不足则追问且 round+1
    - 信息完整后经 Ai_Proxy 生成 2-12 阶段规划，写 Plans + Phases（start_date 默认当日），分解每日任务写 Daily_Tasks
    - `POST /api/plans/generate`、`POST /api/plans/{id}/clarify`（SSE）路由接线
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 18.2 实现文档就绪性检查与文档驱动规划
    - 接收 documentIds，经 Document_Service 判定就绪性（存在该 doc_id 的 chunk 行）
    - 就绪文档检索文本块拼入规划上下文；未就绪文档排除并通过 notice(skippedDocs) 提示
    - _Requirements: 9.7, 9.8, 17.3, 17.4_

  - [x]* 18.3 编写规划追问与文档就绪性属性测试（Hypothesis，mock 外呼）
    - **Property 12: 缺失字段追问精确指明**
    - **Validates: Requirements 9.2**
    - **Property 13: 追问轮次上界为 3 且状态机必终止**
    - **Validates: Requirements 9.3, 9.4, 9.5**
    - **Property 22: 未就绪文档不被纳入规划依据**
    - **Validates: Requirements 9.8, 17.4**
    - 每个属性单独用例，注释 `Feature: study-pilot, Property 12/13/22`，≥100 次迭代
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.8, 17.4_

  - [x]* 18.4 编写规划生成单元测试
    - mock 生成结果验证阶段数 ∈ [2,12] 与每日任务分解；documentIds 透传
    - _Requirements: 9.1, 9.6, 17.3_

- [x] 19. 实现规划中途修改
  - [x] 19.1 实现对话重新生成与阶段局部微调
    - `POST /api/plans/{id}/regenerate`（SSE）依据新输入更新整份规划记录
    - `PATCH /api/phases/{id}` 仅更新目标阶段记录，其余阶段不变
    - _Requirements: 10.1, 10.2, 10.3_

  - [x]* 19.2 编写局部微调属性测试（Hypothesis）
    - **Property 14: 局部微调仅影响目标阶段**
    - **Validates: Requirements 10.3**
    - 注释 `Feature: study-pilot, Property 14`，≥100 次迭代
    - _Requirements: 10.3_

- [x] 20. 实现打卡、任务状态联动与学习指标
  - [x] 20.1 实现打卡接口
    - `POST /api/check-ins` 写入 Check_Ins（时长>0、难度/精力 1-5、备注）
    - `GET /api/daily-tasks?date=` 查询某日任务
    - _Requirements: 4.7, 11.3_

  - [x] 20.2 实现任务状态切换与 Phase 进度重算
    - `PATCH /api/daily-tasks/{id}/status` pending↔done 切换后重算所属 Phase `progress_percent = round(done数/总数×100)`（总数 0 约定为 0）
    - _Requirements: 16.1, 16.2_

  - [x] 20.3 实现 Metrics_Service 与总览指标接口
    - 累计分钟=SUM(duration_minutes)；连续天数从今天/最近打卡日回溯遇缺口中断；剩余天数=max(0,goal_date-today)；阶段进度=已完成/总阶段
    - 今日三态：无 Daily_Task→未反馈；有 Daily_Task 无 Check_In→已安排；有两者→已完成
    - `GET /api/metrics/overview?today=`（用户本地日期）路由接线
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 16.3_

  - [x]* 20.4 编写指标与联动属性测试（Hypothesis）
    - **Property 8: 打卡数据往返一致**
    - **Validates: Requirements 4.7, 11.3**
    - **Property 17: 连续打卡天数在首个缺口处中断**
    - **Validates: Requirements 15.3**
    - **Property 18: 累计分钟等于求和、剩余天数与阶段进度口径一致**
    - **Validates: Requirements 15.1, 15.4, 15.5**
    - **Property 19: 环形进度落在 0-100 且随时间单调**
    - **Validates: Requirements 4.1**
    - **Property 20: Phase 进度重算正确性**
    - **Validates: Requirements 16.2**
    - **Property 21: 今日任务三态判定映射正确**
    - **Validates: Requirements 16.3**
    - 每个属性单独用例，注释 `Feature: study-pilot, Property 8/17/18/19/20/21`，≥100 次迭代
    - Property 19 为前端纯函数（`frontend/src/lib/goalProgress.ts`），由前端 fast-check 覆盖
    - 后端侧 8/17/18/20/21 见 `backend/tests/test_study_properties.py`
    - _Requirements: 4.1, 4.7, 11.3, 15.1, 15.3, 15.4, 15.5, 16.2, 16.3_

- [x] 21. 实现错题本与周报接口
  - [x] 21.1 实现错题本接口
    - `GET /api/mistakes`（列表 + 待复习角标=pending 数）、`GET /api/mistakes/{id}`（详情）、`PATCH /api/mistakes/{id}/review-status`
    - _Requirements: 6.2, 6.3, 6.5_

  - [x] 21.2 实现周报生成与查询
    - 定时任务：某自然周周日 24:00 后且该周有 ≥1 条 Check_In 才生成 Weekly_Review；无打卡则不生成
    - `GET /api/weekly-reviews/latest`（未满一周返回空状态标记）
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x]* 21.3 编写错题角标属性测试（Hypothesis / fast-check）
    - **Property 9: 待复习角标等于 pending 错题数**
    - **Validates: Requirements 6.2**
    - 注释 `Feature: study-pilot, Property 9`，≥100 次迭代
    - 见 `tests/test_mistake_document_properties.py`；另支持 `POST /api/mistakes` 手动录入
    - _Requirements: 6.2_

- [x] 22. 前端接入真实接口
  - [x] 22.1 接入认证、API 配置与文档上传/选择
    - 实现前端 API 客户端；接入注册/登录/会话守卫、ApiConfigForm 增删改查（掩码显示）
    - GoalSubmitForm 的 DocumentPicker 加载 User_Documents、多选、对未就绪文档展示「尚未就绪」并禁选，提交时传 documentIds
    - _Requirements: 1.1, 1.4, 2.1, 2.10, 17.1, 17.2, 17.3, 17.4_

  - [x] 22.2 接入总览/Roadmap/错题本/周报真实数据
    - 用真实接口替换 mock：metrics/overview、daily-tasks、check-ins、任务状态切换、mistakes、weekly-reviews/latest
    - 打卡后刷新今日三态与阶段进度
    - 个人中心右栏待办/动态由 daily-tasks 与文档/规划/错题/周报派生（无独立 activities 表）
    - _Requirements: 4.2, 4.4, 4.7, 5.2, 6.3, 7.3, 16.1, 16.3_

  - [x] 22.3 AI 助手悬浮窗与规划接入真实 SSE
    - ChatWindow 用 fetch ReadableStream/EventSource 订阅 `/api/assistant/chat` 真实 SSE 替换 mock 流；打字机渲染真实 token
    - GoalSubmitForm 接 `/api/plans/generate`、clarify、regenerate 的 SSE；断连保留已渲染内容并提示
    - 说明：对话式目标设定与修改在 AI 助手悬浮窗聊天窗口内进行（需求 8.12）
    - _Requirements: 3.6, 3.7, 3.10, 8.8, 9.1_

  - [x]* 22.4 编写前端接入集成测试
    - 登录后数据加载与降级；SSE 流式渲染；打卡→三态刷新、任务 done→进度更新端到端
    - Vitest：`src/lib/__tests__/integration.test.ts`；命令 `npm run test`
    - _Requirements: 1.8, 1.9, 3.6, 3.7, 16.2, 16.3_

- [x] 23. 第五阶段收尾 - 运行并手动测试
  - 前后端联调：完整走通 注册登录 → 配置 API → 上传文档 → 提交目标（含追问/文档驱动）→ 查看 Roadmap → 打卡 → 标记任务 → 查看指标/周报 → AI 助手悬浮窗对话
  - 运行全部后端 Hypothesis 与前端 vitest 接入测试及单元/集成测试
  - 手动清单见 `DEPLOY.md`「任务 23 · 第五阶段手动联调清单」
  - **提醒用户**：请配置真实 AI API 按该清单逐项勾选验证 SSE 打字机、追问、文档就绪与指标口径；确认后本 spec 实现完成。

## Notes

- 带 `*` 的子任务为可选测试任务，可为更快 MVP 跳过；核心实现任务不带 `*`，必须实现。
- 每个任务标注 `_Requirements: x.y_`，覆盖 requirements 的具体子需求以保证可追溯。
- 每阶段末尾均有「运行并手动测试 + 提醒用户」任务，保证增量验证、避免大爆炸式集成。
- 26 条 Correctness Properties 均已安排到相应功能任务之后：后端用 Hypothesis、前端纯逻辑（含动效纯函数 Property 23-26）用 fast-check，每个属性单独用例、≥100 次迭代、注释格式 `Feature: study-pilot, Property N`。
- 涉及外部 AI 的属性（12/13/22）在测试中 mock 外呼，仅测本系统逻辑。
- 动效阶段（第二阶段）严格遵循「先静态 UI → 组件库（任务 25）→ 逐页注入（任务 26-30）→ 性能调试（任务 31）」的顺序；性能调试（任务 31）与视觉/响应式核对为手动验证。
- Property 23-26 为动效纯函数属性测试（fast-check），挂在 Motion Library 任务 25 之下（25.6-25.9）。

## Task Dependency Graph

说明：
- **必须串行的阶段边界**：第一阶段（脚手架/主题/store 基础与四大页面**全静态 UI**，wave 0-2）→ 第二阶段（交互动效：先 Motion Library 组件库 wave 3，再逐页注入 wave 4，再性能调试 wave 5）→ 第三阶段（AI 助手悬浮窗，wave 6-8）→ 第四阶段（后端骨架/表/加密，wave 9-10）→ 第五阶段（AI 逻辑与前端接入，wave 11+）。
- **动效顺序强制**：动效不在第一阶段做；Motion Library（任务 25.x）必须在四大页面静态 UI（任务 4/5）之后（wave 3）；逐页注入（任务 26-30）依赖对应静态页面任务 + Motion Library（wave 4）；性能调试（任务 31）在动效注入之后（wave 5）。AI 助手悬浮窗动效（任务 9.4）依赖组件 9.1/9.2 与 Motion Library。
- **已完成任务**：1.1、1.2、2.1、2.2 已实现，保持在靠前 wave（0-1）不变。
- **后端前置**：后端骨架（wave 9）是所有后端服务的前置；前端接入真实接口（wave 12+）依赖对应后端接口就绪。
- **可并行**：同一 wave 内任务相互独立、写不同文件，可并行执行（如四大页面静态 UI、各动效属性测试、9 张表就绪后的各后端服务）。
- **测试后置**：属性/单元测试放在其覆盖的实现任务之后的 wave。

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.2", "3.1"] },
    { "id": 2, "tasks": ["4.1", "4.2", "4.3", "5.1", "5.2", "5.3", "6.1", "6.2"] },
    { "id": 3, "tasks": ["24", "25.1", "25.2", "25.3", "25.4", "25.5"] },
    { "id": 4, "tasks": ["25.6", "25.7", "25.8", "25.9", "26", "27", "28", "29", "30"] },
    { "id": 5, "tasks": ["31"] },
    { "id": 6, "tasks": ["8.1", "8.2"] },
    { "id": 7, "tasks": ["8.3", "9.1", "9.2"] },
    { "id": 8, "tasks": ["9.3", "9.4"] },
    { "id": 9, "tasks": ["11.1", "11.2"] },
    { "id": 10, "tasks": ["11.3", "12.1"] },
    { "id": 11, "tasks": ["12.2", "13.1", "14.1"] },
    { "id": 12, "tasks": ["13.2", "13.3", "14.2"] },
    { "id": 13, "tasks": ["13.4", "13.5", "14.3", "16.1", "17.1"] },
    { "id": 14, "tasks": ["14.4", "14.5", "16.2", "16.3", "17.2", "18.1", "20.1", "21.1"] },
    { "id": 15, "tasks": ["18.2", "19.1", "20.2", "20.3", "21.2"] },
    { "id": 16, "tasks": ["18.3", "18.4", "19.2", "20.4", "21.3"] },
    { "id": 17, "tasks": ["22.1", "22.2", "22.3"] },
    { "id": 18, "tasks": ["22.4"] }
  ]
}
```
