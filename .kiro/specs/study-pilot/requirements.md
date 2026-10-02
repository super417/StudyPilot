# Requirements Document

## Introduction

StudyPilot 是一款面向考研 / 科研成长的 AI 学习规划 Web 应用。用户输入需要学习的书籍 / 文档与学习目标后，系统借助用户自备的 AI 模型能力生成分阶段学习路线图（Roadmap），并通过每日打卡、错题本、周报复盘等模块，帮助用户持续跟踪与调整学习进度。用户上传的书籍 / 文档经解析与文本切块后可作为 AI 规划的输入依据。产品配备可全局拖拽的 AI 助手悬浮窗，支持流式对话与跨页面上下文唤起。

本文档采用极简清爽的浅色视觉风格，主色调为薄荷绿 / 草绿色，包含总览、Roadmap、错题本、本周复盘四大页面。系统对用户 AI API Key 采用后端代理调用与 AES 加密存储，严禁前端直连与明文存储。

本需求文档覆盖：用户认证、AI API 配置（含更新与删除）与加密代理、四大页面 UI/UX、AI 助手悬浮窗（拖拽 / 边界限制 / 流式输出 / 跨组件上下文）、书籍 / 文档驱动的 AI 规划与三轮追问边界、规划中途修改、每日任务状态流转、学习指标计算口径、周报触发时机、数据存储与文档切块、响应式布局、视觉设计系统、交互动效与高级动画、以及技术架构与安全约束。

## Glossary

- **StudyPilot / System（系统）**: 整个 StudyPilot Web 应用，包含前端界面与后端服务。
- **Frontend（前端）**: 基于 React 或 Vue 与 Tailwind CSS 构建的浏览器端界面。
- **Backend（后端）**: 基于 Node.js 或 Python(FastAPI) 构建的服务端，负责数据存储与 AI API 代理。
- **Database（数据库）**: 持久化存储，开发环境使用 SQLite，生产环境使用 PostgreSQL。
- **Auth_Service（认证服务）**: 后端中负责用户注册、登录与会话管理的模块。
- **Api_Config_Service（API 配置服务）**: 后端中负责保存、加密与验证用户 AI API 配置的模块。
- **Ai_Proxy（AI 代理）**: 后端中代表用户调用外部 AI 模型接口的模块，前端不得直连外部 AI 接口。
- **AI 助手悬浮窗（Assistant_Widget）**: 全局悬浮的 AI 聊天助手组件，展示为右下角可拖拽的聊天图标与聊天窗口。
- **Planner（规划器）**: 后端中根据用户学习目标生成分阶段学习规划的模块。
- **Overview_Page（总览页）**: 展示当前目标、进度、打卡指标与本周日历的页面。
- **Roadmap_Page（路线图页）**: 展示阶段 1 至阶段 7 进度卡片与周任务详情的页面。
- **Mistake_Book_Page（错题本页）**: 左右分栏展示错题列表与错题详情的页面。
- **Weekly_Review_Page（本周复盘页）**: 展示周报数据指标、知识掌握明细与知识掌握环形图的页面。
- **Check_In（打卡）**: 用户提交实际学习时长、主观难度、精力状态与备注的一次记录。
- **Mistake（错题）**: 一条错题记录，包含原题、我的答案、为什么错、正确理解等字段。
- **Weekly_Review（周报）**: 一周学习结束后自动生成的复盘报告。
- **User_Document（用户文档）**: 用户上传的书籍 / 文档，其文本内容经解析与文本切块后存入数据库，可作为 Planner 生成规划的输入依据。
- **Daily_Task（每日任务）**: 学习规划分解后写入 Daily_Tasks 表的单条每日任务，具有 pending 与 done 两种状态。
- **Phase（阶段）**: 学习规划中的一个阶段，写入 Phases 表，包含进度百分比 progress_percent 字段。
- **Learning_Metrics（学习指标）**: 由 Check_In、Plan 与 Phase 记录派生的展示指标，包含累计打卡分钟、连续打卡天数、剩余天数与阶段进度。
- **API Key**: 用户自备的外部 AI 模型访问凭证。
- **SSE（Server-Sent Events）**: 后端向前端推送流式响应的通信方式。
- **AES 加密**: 用于加密存储 API Key 的对称加密算法。
- **Framer Motion**: 前端所采用的 React 动画库，用于实现入场动画、手势交互与滚动驱动动效。
- **Motion_Library（动效组件库）**: Frontend 中一套可复用、参数可配置的动画组件集合，包含 FadeIn、Magnet、AnimatedText 与 StickyStack 组件。
- **FadeIn（通用入场组件）**: 元素进入视口时播放淡入位移入场动画的可复用组件。
- **Magnet（磁吸组件）**: 使目标元素在光标接近时向光标方向追踪位移的可复用组件。
- **AnimatedText（滚动显字组件）**: 随滚动进度使文本字符逐个显现的可复用组件。
- **StickyStack（粘性堆叠组件）**: 使卡片列表以粘性定位逐层缩放堆叠的可复用组件。

## Requirements

### 需求 1：用户注册与登录

**用户故事:** 作为一名学习者，我希望能够注册与登录账号，以便保存并在下次访问时恢复我的学习数据。

#### 验收标准

1. WHEN 用户提交包含唯一标识（长度 3 至 64 个字符）与密码（长度 8 至 128 个字符）的注册信息，THE Auth_Service SHALL 在 Database 的 Users 表中创建一条新用户记录并返回注册成功状态。
2. IF 用户注册时提交的唯一标识或密码为空，或唯一标识长度不在 3 至 64 个字符范围内，或密码长度不在 8 至 128 个字符范围内，THEN THE Auth_Service SHALL 拒绝本次注册、不创建任何用户记录，并返回指明具体校验失败原因的错误提示。
3. IF 用户注册时提交的唯一标识已存在，THEN THE Auth_Service SHALL 返回标识已被占用的错误提示并终止本次注册，且不修改 Database 中任何已存记录。
4. WHEN 用户提交与已存记录匹配的登录凭证，THE Auth_Service SHALL 建立已认证会话、将该用户连续登录失败计数重置为 0，并返回登录成功状态。
5. IF 用户提交的登录凭证与 Database 中记录不匹配，THEN THE Auth_Service SHALL 拒绝建立会话、将该用户连续登录失败计数加 1，并返回凭证无效的错误提示。
6. IF 用户在同一唯一标识上连续登录失败达到 5 次，THEN THE Auth_Service SHALL 锁定该账号 15 分钟、在锁定期内拒绝任何登录请求，并返回指明账号已被锁定及剩余锁定时间的错误提示。
7. WHILE 已认证会话处于活动状态且距用户最近一次操作已超过 30 分钟，THE Auth_Service SHALL 终止该会话并要求用户重新登录。
8. WHEN 用户成功登录，THE Backend SHALL 从 Database 加载该用户的 API 配置与历史数据。
9. IF 用户成功登录后从 Database 加载 API 配置或历史数据失败，THEN THE Backend SHALL 保持会话为已认证状态、返回指明数据加载失败的错误提示，并允许用户在无历史数据的情况下继续使用。
10. THE Auth_Service SHALL 以加盐哈希形式在 Database 中存储用户密码。

### 需求 2：AI API 配置

**用户故事:** 作为一名学习者，我希望在设置中填入自己的 AI API 配置，以便系统使用我自己的模型额度生成学习规划与对话。

#### 验收标准

1. WHERE 用户处于设置界面，THE Frontend SHALL 提供输入 API Key、模型类型与 Base URL 的表单。
2. IF 用户提交 API 配置时 API Key、模型类型或 Base URL 中任一为空，THEN THE Frontend SHALL 阻止提交并显示指明缺失字段的错误提示。
3. IF 用户提交的 Base URL 不符合以 http:// 或 https:// 开头的 URL 格式，THEN THE Frontend SHALL 阻止提交并显示指明 Base URL 格式无效的错误提示。
4. WHEN 用户提交通过前端校验的 API 配置，THE Api_Config_Service SHALL 通过一次测试调用验证该配置的可用性，且该测试调用的超时时间为 10 秒。
5. IF 测试调用在 10 秒内未返回响应，THEN THE Api_Config_Service SHALL 判定验证失败、返回指明请求超时的错误提示并且不将该配置标记为可用。
6. IF 测试调用返回错误响应或验证不通过，THEN THE Api_Config_Service SHALL 返回指明验证失败原因的错误提示并且不将该配置标记为可用。
7. WHEN API 配置验证成功，THE Api_Config_Service SHALL 将该配置（含 API Key、模型类型、Base URL）存入 Database 的 Api_Configs 表并将该配置标记为可用。
8. THE Api_Config_Service SHALL 使用 AES 加密后再将 API Key 写入 Database。
9. THE Api_Config_Service SHALL 拒绝以明文形式将 API Key 写入 Database。
10. WHEN 前端展示已保存的 API 配置，THE Frontend SHALL 对 API Key 进行掩码显示，仅显示 API Key 的后 4 位字符、其余字符以掩码符号替代。
11. WHEN 用户提交对已有 API 配置的更新且该更新通过验证，THE Api_Config_Service SHALL 以新配置覆盖 Api_Configs 表中的原记录，并对 API Key 使用 AES 加密后再写入 Database。
12. WHEN 用户请求删除已有 API 配置，THE Api_Config_Service SHALL 从 Database 的 Api_Configs 表删除该配置记录。
13. IF 用户在 Database 中不存在标记为可用的 API 配置时发起 AI 相关操作，THEN THE System SHALL 拒绝该操作并返回指示需先配置 API 的错误提示。

### 需求 3：AI API 安全代理与流式通信

**用户故事:** 作为一名对隐私敏感的学习者，我希望我的 API Key 只在后端使用，以便凭证不会在浏览器端暴露。

#### 验收标准

1. WHEN 前端需要调用外部 AI 模型，THE Frontend SHALL 通过 Backend 的 Ai_Proxy 发起请求，且请求中不包含任何 API Key 或凭证字段。
2. THE Ai_Proxy SHALL 代表用户向外部 AI 接口发起调用，并且在向 Frontend 返回的任何响应体、响应头或错误信息中均不包含外部 AI 接口凭证。
3. WHEN Ai_Proxy 需要使用 API Key，THE Ai_Proxy SHALL 从 Database 读取该用户的加密 API Key，解密后仅在 Backend 进程内存中用于外部调用。
4. IF Ai_Proxy 解密该用户的 API Key 失败，THEN THE Ai_Proxy SHALL 终止本次外部调用，向 Frontend 返回指示凭证不可用的错误提示，并且不向外部 AI 接口发起任何请求。
5. IF 用户在 Database 中不存在有效的 API Key 记录，THEN THE Ai_Proxy SHALL 终止本次外部调用，并向 Frontend 返回指示需先配置 API Key 的错误提示。
6. WHEN AI 助手悬浮窗或规划模块请求 AI 响应，THE Backend SHALL 通过 SSE 以流式方式向 Frontend 推送响应内容。
7. WHILE Backend 正在通过 SSE 推送 AI 响应，THE Frontend SHALL 以打字机效果逐步渲染已接收的内容。
8. IF 外部 AI 接口在 30 秒内未返回首个响应数据块，THEN THE Ai_Proxy SHALL 中止该外部调用，通过 SSE 向 Frontend 推送指示 AI 响应超时的错误事件，并关闭该 SSE 连接。
9. IF Ai_Proxy 与 Frontend 之间的 SSE 连接在推送过程中中断，THEN THE Ai_Proxy SHALL 停止本次外部 AI 调用并释放相关资源，且不再尝试向该已中断的连接推送内容。
10. IF Frontend 与 Backend 之间的 SSE 连接中断，THEN THE Frontend SHALL 保留已接收并渲染的内容，并向用户显示指示连接中断的提示。

### 需求 4：总览页面

**用户故事:** 作为一名学习者，我希望在总览页看到当前目标与今日任务，以便快速了解进度并开始今天的学习。

#### 验收标准

1. WHERE 用户位于 Overview_Page 左侧主卡片，THE Overview_Page SHALL 展示当前目标大标题、副标题以及表示备考时间流逝百分比的环形进度条，该环形进度条的值 =（当前日期 − 规划开始日期）/（目标日期 − 规划开始日期）× 100%，并约束在 0 至 100 之间。
2. THE Overview_Page SHALL 在主卡片中展示剩余天数、累计打卡分钟、连续打卡天数与阶段进度（x/7）四项数据指标。
3. THE Overview_Page SHALL 在主卡片底部展示可横向滚动的本周日历，并标注当天日期。
4. WHERE 用户位于 Overview_Page 右侧任务卡片，THE Overview_Page SHALL 以绿色背景展示今日日期、今日任务状态（未反馈 / 已安排 / 已完成）与「开始今天的学习」按钮，其中今日任务状态的判定规则与需求 16 保持一致。
5. THE Overview_Page SHALL 提供 60、75、90 分钟的时长快捷选项。
6. THE Overview_Page SHALL 提供打卡表单，包含实际学习分钟、主观难度（1 至 5）、精力状态（1 至 5）与备注字段。
7. WHEN 用户在打卡表单中点击「完成打卡」，THE Backend SHALL 将该次打卡记录存入 Database 的 Check_Ins 表。

### 需求 5：Roadmap 页面

**用户故事:** 作为一名学习者，我希望查看分阶段的学习路线图，以便了解整体规划与每周的具体任务。

#### 验收标准

1. THE Roadmap_Page SHALL 在顶部展示标题「全线阶段路线图 / 你的路线，正在跟着你变化」以及最近更新时间戳。
2. THE Roadmap_Page SHALL 横向排列阶段 1 至阶段 7 的进度卡片，每张卡片展示阶段名称、日期范围与进度百分比。
3. THE Roadmap_Page SHALL 对当前所处阶段的进度卡片进行高亮显示。
4. THE Roadmap_Page SHALL 在进度卡片下方按周（如 W38、W47）分组展示周任务详情卡片，每组显示该阶段任务数与每日任务描述。

### 需求 6：错题本页面

**用户故事:** 作为一名学习者，我希望在错题本中查看错题详情，以便理解错误原因并安排复习。

#### 验收标准

1. THE Mistake_Book_Page SHALL 采用左右分栏布局，左侧为错题列表，右侧为错题详情。
2. THE Mistake_Book_Page SHALL 在左侧错题列表（Review Queue）上展示待复习数量角标。
3. WHEN 用户在左侧列表选择一条错题，THE Mistake_Book_Page SHALL 在右侧展示该错题的原题、我的答案、为什么错与正确理解卡片。
4. THE Mistake_Book_Page SHALL 以深墨绿底白字样式展示原题卡片、以红底样式展示我的答案卡片、以绿底样式展示正确理解卡片。
5. THE Mistake_Book_Page SHALL 在详情底部展示「回到学习助手重新做一道」按钮，并在右侧展示该错题的复习安排状态。
6. WHEN 用户点击「回到学习助手重新做一道」按钮，THE System SHALL 唤起 AI 助手悬浮窗并将该错题作为对话上下文带入。

### 需求 7：本周复盘页面

**用户故事:** 作为一名学习者，我希望查看每周复盘报告，以便认识自己的学习状态与知识掌握情况。

#### 验收标准

1. WHERE 用户尚未完成一周学习，THE Weekly_Review_Page SHALL 展示提示「一周之后，这里会帮你认识自己」，并展示提示「完成一周学习后自动生成第一份周报」。
2. THE Weekly_Review_Page SHALL 在右上角以紫色环形图展示知识掌握平均值。
3. THE Weekly_Review_Page SHALL 展示累计投入、连续天数与任务完成率三项数据指标卡片。
4. THE Weekly_Review_Page SHALL 以进度条形式展示各科目掌握度百分比的知识掌握明细。
5. WHEN 一个自然周结束（该周周日 24:00 之后）且该周内存在至少一条 Check_In 记录，THE System SHALL 为该周自动生成一份 Weekly_Review 并存入 Database 的 Weekly_Reviews 表。
6. IF 某自然周内不存在任何 Check_In 记录，THEN THE System SHALL 不为该周生成 Weekly_Review。

### 需求 8：AI 助手悬浮窗（全局悬浮助手）

**用户故事:** 作为一名学习者，我希望在任意页面随时呼出 AI 助手，以便获得即时帮助而不打断当前操作。

#### 验收标准

1. THE AI 助手悬浮窗 SHALL 以固定定位（fixed）与不低于 9000 的 z-index 悬浮于所有页面内容之上，且不随页面滚动而改变其在视口中的位置。
2. THE AI 助手悬浮窗 SHALL 在视口右下角（距右边界与下边界各 24 像素）展示可通过拖拽移动位置的聊天图标。
3. WHILE 用户拖拽 AI 助手悬浮窗图标，THE AI 助手悬浮窗 SHALL 实时将图标的边界约束在视口可视区域内，使图标任一边缘与视口对应边界的间距不小于 0 像素。
4. IF 用户将 AI 助手悬浮窗图标拖拽至超出视口边界的位置，THEN THE AI 助手悬浮窗 SHALL 将图标位置钳制到最近的合法边界处（图标完整可见），并停留在该位置。
5. WHEN 浏览器窗口尺寸发生 resize 且当前图标位置导致图标任一部分位于新视口范围之外，THE AI 助手悬浮窗 SHALL 在 resize 完成后 500 毫秒内重新将图标位置钳制到新视口边界内的最近合法位置。
6. WHEN 用户点击 AI 助手悬浮窗图标，THE AI 助手悬浮窗 SHALL 在 300 毫秒内弹出聊天窗口，并将窗口约束在视口可视区域内完整显示。
7. WHEN 用户在 AI 助手悬浮窗聊天窗口发送消息，THE AI 助手悬浮窗 SHALL 支持多轮对话并按发送时间顺序保留当前会话的全部历史消息（会话内至少保留最近 100 条消息）。
8. WHILE AI 助手悬浮窗接收 AI 响应，THE AI 助手悬浮窗 SHALL 以打字机效果按接收顺序逐步流式渲染响应内容。
9. IF AI 助手悬浮窗在流式渲染 AI 响应过程中连接中断或用户主动停止，THEN THE AI 助手悬浮窗 SHALL 停止后续渲染、保留已接收的部分内容作为该轮消息，并以可见的错误提示告知用户响应未完成，且当前会话历史消息不被清除。
10. WHEN 页面其他组件的按钮（如错题详情「去 AI 助手悬浮窗说一句」）被点击，THE AI 助手悬浮窗 SHALL 被唤起、弹出聊天窗口，并载入该按钮传入的对应上下文。
11. IF AI 助手悬浮窗已处于打开状态且已载入上下文时页面其他组件的唤起按钮被再次点击并传入新的上下文，THEN THE AI 助手悬浮窗 SHALL 以新传入的上下文覆盖当前上下文，并保留当前会话已有的历史消息。
12. WHEN 用户在 AI 助手悬浮窗聊天窗口内输入学习目标或修改指令，THE System SHALL 将该输入传递给 Planner 用于生成或更新学习规划。

### 需求 9：AI 学习规划与追问逻辑

**用户故事:** 作为一名学习者，我希望输入学习目标后系统能生成规划，并在信息不足时主动追问，以便得到贴合我情况的学习路线。

#### 验收标准

1. WHEN 用户提交的学习目标包含全部必填字段（目标名称、目标日期、当前水平、每日可用学习时长），THE Planner SHALL 在 30 秒内生成一份包含 2 至 12 个阶段的学习规划，并将规划记录写入 Database 的 Plans 表、将各阶段记录写入 Phases 表。
2. IF 用户提交的学习目标缺少任一必填字段（目标名称、目标日期、当前水平、每日可用学习时长），THEN THE Planner SHALL 判定为信息不足，并向用户发起一轮追问，追问内容需指明所缺失的具体字段。
3. THE Planner SHALL 将针对同一学习目标的自动追问限制在最多 3 轮以内，其中一轮定义为一次「系统提问 + 用户回复」的完整问答循环，追问轮次计数器仅在同一目标范围内累加。
4. WHILE 针对同一目标的追问轮次计数小于 3，WHEN 用户回复后信息仍不完整，THE Planner SHALL 发起下一轮追问并将追问轮次计数加 1。
5. WHEN 针对同一目标的自动追问轮次达到 3 且信息仍不完整，THE Planner SHALL 停止追问、向用户显示一条提示信息（说明系统将基于已提供信息生成规划），并基于已有信息生成学习规划。
6. WHEN 学习规划生成完成，THE Planner SHALL 将该规划分解为每日任务，并将每日任务记录写入 Database 的 Daily_Tasks 表。
7. WHEN 用户在提交学习目标时选择了已上传的 User_Document，THE Planner SHALL 在生成规划时引用该文档在 User_Documents 表中的文本块内容作为规划依据。
8. IF 用户所选择的 User_Document 尚未完成解析与文本切块，THEN THE Planner SHALL 向用户提示该文档尚未就绪，并在本次规划中不将该文档纳入规划依据。

### 需求 10：规划中途修改

**用户故事:** 作为一名学习者，我希望在生成规划后仍能调整它，以便让规划持续贴合我的实际进度。

#### 验收标准

1. WHERE 用户已生成学习规划，THE System SHALL 提供「对话重新生成」与「点击卡片手动局部微调」两种修改模式。
2. WHEN 用户通过对话请求重新生成规划，THE Planner SHALL 依据用户新输入生成更新后的规划并更新 Database 中对应记录。
3. WHEN 用户点击某张阶段卡片进行手动微调，THE System SHALL 仅更新该阶段对应的记录，并保留其他阶段不变。

### 需求 11：数据存储与文档切块

**用户故事:** 作为一名学习者，我希望我的配置、错题、打卡、周报与上传文档都被保存，以便随时恢复并供 AI 使用。

#### 验收标准

1. THE Database SHALL 持久化存储 Users、Api_Configs、Plans、Phases、Daily_Tasks、Check_Ins、Mistakes、Weekly_Reviews 与 User_Documents 数据实体。
2. THE Mistakes 表 SHALL 存储原题、我的答案、为什么错与正确理解字段。
3. THE Check_Ins 表 SHALL 存储学习时长、主观难度、精力状态与备注字段。
4. THE Api_Configs 表 SHALL 存储 API Key（AES 加密后）、模型类型与 Base URL 字段。
5. WHEN 用户上传格式为 PDF、DOCX、TXT 或 Markdown 且单文件大小不超过 20 MB 的文档，THE Backend SHALL 解析该文档文本内容。
6. WHEN 文档文本解析完成，THE Backend SHALL 将文本切分为每块最多 1000 个字符、相邻块之间重叠 200 个字符的文本块。
7. WHEN 文本切块完成，THE Backend SHALL 将全部文本块及其所属文档标识存入 Database 的 User_Documents 表。
8. IF 上传文档的格式不属于 PDF、DOCX、TXT 或 Markdown，THEN THE Backend SHALL 拒绝该上传、不写入任何文本块，并返回指示不支持文件格式的错误提示。
9. IF 文档解析失败或提取到的文本内容为空，THEN THE Backend SHALL 终止本次切块与存储、不写入部分数据，并返回指示文档解析失败的错误提示。

### 需求 12：视觉设计系统

**用户故事:** 作为一名学习者，我希望界面在极简清爽的浅色护眼风格基础上融合高级排版设计，以便获得舒适、一致且富有设计感的使用体验。

#### 验收标准

1. THE Frontend SHALL 采用浅色护眼模式，页面全局背景使用柔和的浅灰绿色（#F7FAF8），卡片使用纯白背景（#FFFFFF）、大圆角（40px / rounded-[40px]）与极浅的绿色调阴影，使白色卡片在浅灰绿画布上浮起。
2. THE Frontend SHALL 采用四层绿色色彩系统：深墨绿（#064E3B）用于主标题、主按钮与主要文字；主色绿（#10B981）用于高亮标签、Tab 选中态与进度条；浅绿（#A7F3D0）用于标签背景与图表底色；极浅绿（#D1FAE5）用于列表 1px 分割线。
3. THE Frontend SHALL 引入 Kanit 字体用于英文与数字（标题与大号数字），并使用 Inter 搭配系统默认中文字体用于正文，使数字与标题具备强设计感。
4. THE Frontend SHALL 对页面 Hero 主标题（如总览页目标标题）使用 font-black、大写处理、tracking-tight、leading-none、whitespace-nowrap，字号使用 clamp(3rem, 8vw, 160px)，并应用从深墨绿（#064E3B）到主色绿（#10B981）的线性渐变文字（linear-gradient(180deg,#064E3B,#10B981) 配合 background-clip:text 与 text-fill-color:transparent）。
5. THE Frontend SHALL 使用胶囊按钮样式（rounded-full），主按钮背景为深墨绿（#064E3B）、文字白色，并在悬停时呈现轻微光晕效果。
6. THE Frontend SHALL 对总览页右侧任务卡片使用绿色渐变背景、纯白文字；对左侧目标大卡片使用纯白背景并以深墨绿、Kanit 字体呈现足够大且足够粗的数字。
7. THE Frontend SHALL 对错题本原题卡片使用深墨绿背景（#064E3B）、纯白文字；对「正确理解」卡片使用浅绿底（#A7F3D0）；对「我的答案」卡片使用浅红底；并保留大圆角。
8. THE Frontend SHALL 对本周复盘的知识掌握图使用紫色环形图样式。
9. THE Frontend SHALL 在顶部居中展示总览、Roadmap、错题本、本周复盘四个 Tab 切换项，Tab 选中态使用主色绿（#10B981）高亮。
10. THE Frontend SHALL 在左上角展示圆形序号、目标标题与副标题，并在右上角展示「本地学习中 / 学习者」状态。
11. THE Frontend SHALL 采用大字号标题并突出显示数字以强调信息层级，Roadmap 阶段列表左侧数字使用 clamp(3rem, 8vw, 140px)、深墨绿、font-black，列表项之间使用极浅绿（#D1FAE5）的 1px 分割线。

### 需求 13：响应式布局

**用户故事:** 作为一名学习者，我希望在电脑与手机上都能正常使用，以便在不同设备上继续学习。

#### 验收标准

1. THE Frontend SHALL 使用 Tailwind CSS 的 grid 与 flex 布局实现响应式界面。
2. WHILE 视口处于大屏幕宽度，THE Frontend SHALL 以多列卡片布局展示页面内容。
3. WHILE 视口处于手机宽度，THE Frontend SHALL 将卡片布局自动折叠为单列。

### 需求 14：技术架构与安全约束

**用户故事:** 作为系统维护者，我希望系统遵循既定的技术栈与安全约束，以便保障凭证安全与部署一致性。

#### 验收标准

1. THE Frontend SHALL 使用 React 或 Vue 搭配 Tailwind CSS 实现。
2. THE Backend SHALL 使用 Node.js 或 Python(FastAPI) 实现。
3. THE Database SHALL 在开发环境使用 SQLite、在生产环境使用 PostgreSQL。
4. THE Backend SHALL 从 .env 文件读取数据库密码。
5. THE Backend SHALL 拒绝在源代码中写死数据库密码。
6. THE Backend SHALL 使用 AES 加密存储用户 API Key，并拒绝明文存储。
7. THE Frontend SHALL 拒绝直接调用外部 AI 接口，所有外部 AI 调用均经由 Backend 的 Ai_Proxy 完成。

### 需求 15：学习指标计算

**用户故事:** 作为一名学习者，我希望连续天数、累计分钟等指标口径一致，以便信任面板上展示的数据。

#### 验收标准

1. THE System SHALL 将累计打卡分钟计算为该用户全部 Check_In 记录的 duration_minutes 字段之和。
2. THE System SHALL 将某一自然日判定为「已打卡」当且仅当该自然日存在至少一条 Check_In 记录。
3. THE System SHALL 将连续打卡天数计算为从今天（或最近一个已打卡的自然日）向前回溯、连续每个自然日均为「已打卡」的最长天数；WHEN 回溯过程中遇到某个未打卡的自然日，THE System SHALL 在该自然日处中断连续天数计数。
4. THE System SHALL 将剩余天数计算为目标日期与当前日期之间的自然日差，并将该值约束为不小于 0。
5. THE System SHALL 将阶段进度计算为已完成阶段数除以总阶段数。
6. THE System SHALL 以用户本地日期作为判定跨天边界与所有自然日归属的依据。

### 需求 16：每日任务状态与进度联动

**用户故事:** 作为一名学习者，我希望标记任务完成并看到进度随之更新，以便跟踪实际进展。

#### 验收标准

1. WHERE 用户位于 Overview_Page 或 Roadmap_Page，THE System SHALL 允许用户将某条 Daily_Task 的状态在 pending 与 done 之间切换。
2. WHEN 用户将某条 Daily_Task 标记为 done，THE System SHALL 将该任务所属 Phase 的 progress_percent 更新为该 Phase 中状态为 done 的任务数除以该 Phase 的任务总数。
3. THE Overview_Page SHALL 依据当日是否存在 Daily_Task 记录与当日是否存在 Check_In 记录展示今日任务状态：WHERE 当日不存在 Daily_Task 记录，THE Overview_Page SHALL 展示「未反馈」；WHERE 当日存在 Daily_Task 记录且不存在 Check_In 记录，THE Overview_Page SHALL 展示「已安排」；WHERE 当日存在 Daily_Task 记录且存在 Check_In 记录，THE Overview_Page SHALL 展示「已完成」。

### 需求 17：规划输入文档选择

**用户故事:** 作为一名学习者，我希望在提交学习目标时选择要作为规划依据的书籍 / 文档，以便让 AI 规划贴合具体教材内容。

#### 验收标准

1. WHERE 用户处于学习目标提交界面，THE Frontend SHALL 展示该用户已上传的 User_Document 列表供用户选择。
2. THE Frontend SHALL 允许用户在提交学习目标时选择零个或多个 User_Document 作为规划输入。
3. WHEN 用户提交包含所选 User_Document 标识的学习目标，THE Frontend SHALL 通过 Backend 将所选 User_Document 标识传递给 Planner。
4. THE Frontend SHALL 对尚未完成解析与文本切块的 User_Document 展示「尚未就绪」的状态标识。

### 需求 18：交互动效与动画体验

**用户故事:** 作为一名学习者，我希望界面具备流畅丰富的微交互与动画，以便获得高级、顺滑的使用体验。

#### 验收标准

1. THE Frontend SHALL 基于 Framer Motion 提供一套可复用、参数可配置的 Motion_Library，且该组件库包含 FadeIn（通用入场）、Magnet（磁吸按钮）、AnimatedText（滚动显字）与 StickyStack（粘性堆叠）四个组件。
2. THE FadeIn 组件 SHALL 支持可配置的 delay、duration、x 与 y 参数，其默认 duration 为 0.7 秒、默认缓动曲线为 [0.25, 0.1, 0.25, 1]。
3. WHEN 应用了 FadeIn 组件的元素首次进入视口，THE FadeIn 组件 SHALL 播放一次入场动画，且在同一元素的后续可见性变化时不再重复播放该入场动画。
4. WHERE Magnet 组件应用于核心按钮（开始今天的学习按钮、完成打卡按钮、AI 助手悬浮窗图标、保存 API 配置按钮），WHEN 光标进入该元素外扩 150 像素的范围，THE Magnet 组件 SHALL 追踪光标相对该元素中心的位移，并以 strength 为 3 的分量对该元素施加 translate3d 位移。
5. WHEN 光标进入 Magnet 组件的触发范围，THE Magnet 组件 SHALL 以 0.3 秒 ease-out 过渡执行位移动画。
6. WHEN 光标离开 Magnet 组件的触发范围，THE Magnet 组件 SHALL 以 0.6 秒 ease-in-out 过渡将该元素复位至原始位置。
7. WHERE AnimatedText 组件应用于总览目标描述文字与周报总结文字，WHILE 用户滚动页面，THE AnimatedText 组件 SHALL 随滚动进度使文本字符逐个从 opacity 0.2 过渡到 opacity 1。
8. THE AnimatedText 组件 SHALL 采用不可见占位符加绝对定位动画层的方式渲染文本，使文本排版位置在动画过程中保持不变。
9. WHERE StickyStack 组件应用于 Overview_Page 每日任务卡片列表，THE StickyStack 组件 SHALL 使各卡片以粘性定位（sticky，top 为 24 像素）逐层堆叠，且第 index 张卡片的目标缩放比例 targetScale 等于 1 −（totalCards − 1 − index）× 0.03。
10. WHILE 用户滚动 Overview_Page，THE Overview_Page SHALL 随滚动进度在浅灰色与极浅薄荷绿色之间平滑过渡背景色。
11. WHEN Overview_Page 主卡片进入视口，THE Overview_Page SHALL 使用 FadeIn 组件以 delay 为 0.15、y 为 40 播放主卡片入场动画，且主卡片内的数字与环形进度使用 spring 弹性动画呈现。
12. WHEN Overview_Page 本周日历日期卡片进入视口，THE Overview_Page SHALL 使第 i 张日期卡片以 i × 0.05 秒的延迟交错入场。
13. WHILE 用户滚动 Overview_Page，THE Overview_Page SHALL 对主卡片施加随滚动变化的视差位移。
14. THE Roadmap_Page SHALL 以垂直错落布局展示阶段列表，每个阶段列表项左侧展示超大数字、右侧展示阶段名称，且第 i 个阶段列表项以 i × 0.1 秒的延迟交错入场。
15. THE Roadmap_Page SHALL 以薄荷绿色背景高亮当前所处阶段的列表项，并以白色背景展示其余阶段列表项。
16. WHEN 光标悬停于某个阶段卡片，THE Roadmap_Page SHALL 使该阶段卡片向右平移并加深其阴影。
17. THE Mistake_Book_Page SHALL 对左侧错题列表项提供光标悬停时的浮起效果，并对当前选中的列表项展示薄荷绿色指示条。
18. WHEN 用户切换所选错题，THE Mistake_Book_Page SHALL 使旧错题详情淡出并向上位移退场、使新错题详情以 y 为 20 淡入入场，且新详情内的原题卡片、我的答案卡片与正确理解卡片分别以 0.1、0.2、0.3 秒的延迟依次错落淡入。
19. WHEN Weekly_Review_Page 的数据指标卡片进入视口，THE Weekly_Review_Page SHALL 使各数据指标卡片交错入场。
20. WHEN Weekly_Review_Page 的知识掌握环形图进入视口，THE Weekly_Review_Page SHALL 使用 SVG pathLength 将环形图从 0 绘制到实际进度值。
21. THE Weekly_Review_Page SHALL 使用 AnimatedText 组件以滚动显字方式呈现顶部提示文字。
22. WHEN 用户点击展开 AI 助手悬浮窗，THE AI 助手悬浮窗 SHALL 以 spring 弹性动画从 scale 0.8 弹入至 scale 1。
23. WHEN 一条对话消息进入 AI 助手悬浮窗，THE AI 助手悬浮窗 SHALL 使该消息以 y 为 20 淡入入场。
24. WHILE AI 助手悬浮窗输入框处于聚焦状态，THE AI 助手悬浮窗 SHALL 呈现输入框边框微光效果。
25. WHILE 用户拖拽 AI 助手悬浮窗，THE AI 助手悬浮窗 SHALL 通过 drag 约束将悬浮窗位置限制在视口可视区域内。
26. WHILE 用户滚动页面，THE Frontend SHALL 在页面顶部展示一条薄荷绿色的细进度条，并使该进度条的 scaleX 随滚动进度变化。
27. WHEN 用户切换顶部 Tab，THE Frontend SHALL 以淡入并向上滑动的进出场动画切换页面内容。
28. THE Frontend SHALL 对长列表（如错题本列表）采用视口内渲染优化（whileInView 或 content-visibility: auto），并对参与动画的元素设置 will-change 为 transform 的性能提示，以维持约 60 帧每秒的滚动帧率。
29. THE Frontend SHALL 在保持需求 12 所定义的浅色模式、薄荷绿主色与卡片式视觉，以及需求 13 所定义的响应式布局的前提下实现本需求所述全部动效，且动效渲染 SHALL 保持既有配色、圆角、阴影与响应式布局不变。
