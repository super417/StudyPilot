# StudyPilot

> 基于证据链与 Agent 工作流的 AI 微专业能力航图。

上传你的讲义与目标，Agent 会读取资料、生成一份可迭代的学习计划，并把它落到每一天的任务、打卡、错题与周复盘上。做题留下判分证据，统计页据此给出学习诊断。

本仓库首次公开发布是一次初始导入，此后的提交历史才是实际计入的开发记录。

---

## 它解决什么问题

面向在修 AI 微专业 / AI 通识课、非计算机专业、大二到大四、想提升就业竞争力的学生，做就业方向的技能差距诊断与掌握度验证。核心主张是用 AI 检测「完成了任务」和「掌握了知识」之间的差距，不用 AI 替学生完成学习。StudyPilot 把「规划—执行—复盘」串成一条闭环：

1. **规划** —— 提交目标 + 上传讲义（PDF / DOCX / TXT / MD），AI 结合资料内容生成分阶段计划；
2. **执行** —— 计划拆到每日任务，打卡记录时长与状态，支持中途调整阶段；
3. **复盘** —— 练习判分与错题本沉淀薄弱点，周复盘、数据统计与学习诊断回答「我这周到底推进了多少、哪里还薄」。

## 功能一览

| 模块 | 说明 |
|---|---|
| 账号与会话 | 注册 / 登录 / 登出，服务端 Cookie 会话，密码 bcrypt 哈希 |
| AI 使用方式 | 二选一：**平台**（平台余额按元计费，或平台积分按点计费；模型与支付渠道由服务端配置，默认关闭）或**自带 API Key**（个人中心「高级设置」，Key 经 AES-256-GCM 加密入库，模型列表由供应商 `/models` 动态拉取） |
| 平台账户与充值 | 个人中心查看余额、调用预留、可用余额、余额明细与充值订单；支付宝网页支付 / 微信 Native 下单，**只有服务端核验通过的支付通知或主动查单才入账** |
| 学习资料 | 上传 PDF / DOCX / TXT / MD，后端解析为文本供规划与问答检索 |
| 目标与规划 | 对话式提交目标 → SSE 流式生成计划（clarify / notice / done 事件）；支持整体重新生成与单阶段微调；「撤销最近一次已确认调整」只在计划确有可撤销记录时出现，收在聊天预览的「计划操作」折叠里，读取失败则不显示 |
| 总览 | Hero + 学习流程叙事 + 明信片式总览，全部读真实接口；「进入我的总览」滚到内容区而非切 Tab；读不到的模块标不可用，**不用指标拼一张假规划卡** |
| Roadmap | 展示最新计划的阶段划分与进度，切换本周任务完成态；每日任务可带直达课程页的资源链接 |
| 每日任务与打卡 | 今日任务列表、打卡记录学习时长、今日三态（未反馈 / 已安排 / 已完成） |
| 练习与判分 | 练习卡片生成；判分方式可选**全部判分 / 勾选判分 / 每 n 题自动判分**，结果（correct / partial / wrong）写入掌握度证据；失败可单独重试 |
| 错题本 | 手动录入或拍照识别错题、查看详情、标记复习状态，按 1/2/4/7/15/30 天排复习 |
| 数据统计 | 指标卡、近 30 日作答量堆叠柱、掌握度分布、错题 TOP5、近 30 日练习日历（点日期看当天证据与得分）、航线、周报 |
| 学习诊断 | 基于真实判分证据生成 AI 诊断报告，支持最新 / 历史 / 搜索三段视图与改名持久化 |
| AI 助手 | SSE 流式对话；领域拦截（非学习类提问会被提示）；结合已上传文档给出摘录；推理强度可调；主聊天与小窗共用同一套凭证与语音缓存；助手人物可拖动、单击聊天、双击展开、收起成小头像并自动避让页面控件 |
| 语音朗读 | 晓晓在线女声；回复正文按句流式播放，新回复可自动预生成音频 |
| 课程与笔记 | 课程章节（可挂用户填写的网页链接、学完打勾）、随手笔记 |
| 简历 | 内置「实用简历管理」编辑器（本地镜像的 Magic Resume），AI 润色走个人中心凭证；另有人网站式简历模板 |
| 演示首屏 | `#/mainframe` 竞赛演示页：Agent 四步工作流动画、引用溯源卡片、站内信卡片 |

> 错题本支持「拍照 / 上传图片」识别题目文字，使用个人中心配置的模型，需选支持识图的模型（如 GPT-4o、Gemini）。

## 总览界面

`#/` 总览不是一个页面，是四层：

1. **Hero**（`StudyPilotHero`）—— 首屏标题与主行动，滚动视差；
2. **学习流程叙事**（`StudyPilotJourney`）—— 滚动驱动的分段讲解，配 Lenis 平滑滚动与 GSAP ScrollTrigger；
3. **明信片式总览**（`StudyPilotPostcards`，`presentation='postcards'`，默认）—— 横向拖动的水彩明信片叠卡，分「今日概览 / 最近周报」两档切换；
4. **内容区**（`#overview-content` 容器内）—— 目标、今日任务、打卡、掌握度、错题待复习等通过弹窗（`OverviewDetailsDialog`）打开，「开始今天的学习」弹 `DailyStartDialog` 选任务。

- **真实数据接入**：总览取 `/api/metrics/overview`、`/api/plans/latest`、`/api/daily-tasks`、`/api/weekly-reviews/latest`、`/api/mistakes`。取不到的模块显示 `—` 并标注不可用，不用假数据填充。指标或计划接口失败时卡片直接标不可用，**不再用指标拼一张「当前学习规划」卡片**。
- **明信片里的学习卡**：今日安排最多 8 条，最近评估 / 回顾复盘最多 6–7 条，条目逐条引用真实任务、判分证据与周报（含样本量），没有记录时写「暂无」而不是留空或编造；卡片高度按真实记录自然长短，不强行拉齐。
- **桌面标题吸顶**：学习卡标题跟随可见的悬浮导航吸顶（吸顶偏移由导航实际 bottom 写入 CSS 变量，导航隐藏时为 0），移动端回到正常文档流。
- **「进入我的总览」入口**：顶部导航与段落 CTA 统一滚到 `#overview-content`（`scrollToLearningOverview`），不切 Tab、不刷新页面；明信片内部的回退路径指向 `#learning-overview`。两处锚点都在，入口定位以内容区为准。
- **返回顶部按钮**：`OverviewBackToTop` 挂在除演示首屏外的所有业务页（总览 / Roadmap / 习题本 / 数据统计 / 我的简历 / 个人中心 / 两个简历子页）。行为是**下滑隐藏、上滑显示、距顶 24px 内隐藏**；点击回到顶部并尊重 `prefers-reduced-motion`。个人中心是三栏独立滚动，点击时会同时把带 `data-back-to-top-scroll` 的内部滚动容器归零。

### 明信片动画字标（2026-10-28）

总览右上信件卡片的字标已从 `MAILERB` 更新为 `STUDYPIL`，后接原有小人偶（作为 O）和末尾 T。

- 资源文件：`frontend/public/postcards/animation/mailerbot-heros.riv`。直接修改 Rive 矢量轮廓，无 CSS 遮罩、DOM 贴字或 canvas 覆盖。
- 字母统一字高与基线，笔画在首版基础上加粗 25%，主要转角圆润化，并按实际字形宽度调整间距；小人偶（含眼睛）与末尾 T 整体纵向居中。
- 保留原有对象、层级和引用；未增删对象，文件长度仍为 **1,186,524 字节**，对象数仍为 **15,022**。桌面 `built` 与移动端 `built_mobile` 共用修改后的卡片资源，原状态机及 `scroll` 绑定保留。
- 已验证完整对象流可解析、对象与属性偏移不变；各轮字节差异仅位于授权的字标顶点/切线及两个居中用的组 Y 坐标。最终加粗轮次中，人偶和末尾 T 的字节及截图区域保持一致。
- 已用 `@rive-app/canvas` 探针加载 `built`、`built_mobile`、`mailerbot-postcard`，均触发 `onLoad`，无 `onLoadError`，探针记录无 error/warn，并核对了改前、改后截图。完整滚动效果仍需在实际页面与参考录屏对照验收。

本次资源 SHA-256：`b3adf7942745e221ad469c1c13ba22fed4165028496b19f3c19b24a6dcc6b484`。

本地查看：启动前端，打开 `#/` 总览并强制刷新，滚动到右上信件卡片，检查拼写 `STUDYPIL` + 小人偶 + T、纵向对齐和随卡片运动的效果；再用移动端宽度复核。调试探针和备份不属于产品交付文件。

## AI 使用方式与配置同步

两种方式二选一，存在后端 `billing_accounts.mode`：`byok`（默认，走自己的 Key，由供应商直接计费）与 `platform`（走平台余额，按实际 token 用量计费）。个人中心中栏首卡是「平台余额与模型选择」，原「API 调用与模型配置」收进同一张卡底部的**高级设置**折叠里 —— 折叠只影响显示，不卸载组件，已保存的 Key 不会因为收起而丢失。

### 平台余额（默认关闭）

- **目录** `GET /api/billing/catalog`：只公开模型 `id`、供应商、显示名、输入 / 输出单价（元 / 百万 token）、输入输出上限、单次预留上限与可用支付渠道，**不公开 Key 和请求地址**。`BILLING_MODELS_JSON` 为空或配置不合法时目录返回空数组，`platformAvailable=false`。
- **账户** `GET /api/billing/account`：当前模式、所选模型、账户余额、调用预留、可用余额、最近 30 条余额明细、最近 20 笔充值订单。
- **切换** `PUT /api/billing/preferences`，body `{mode: 'platform' | 'byok', modelId}`；切回自带 Key 不会删除原有供应商与 Key 配置。
- **计费口径**：整数微元（1 元 = 1,000,000 微元，1 分 = 10,000 微元），费用 = 输入 token × 输入单价 + 输出 token × 输出单价，两项相加后整体向上取整到 1 微元。每次调用先按模型上限原子预留，拿到非空文本与可核验 usage 后按实际量扣费、释放剩余；余额不足直接不调用，网络错误 / 超时 / 缺 usage / 空响应不扣费。
- **覆盖能力**：助手文本对话、规划生成与调整、学习诊断、练习生成与判分。图片识题、资料对比与资料任务、简历润色仍走自带 Key，平台模式下会返回 `PLATFORM_CAPABILITY_UNAVAILABLE`（「此能力暂不支持平台余额，请切换自带 Key」）。
- **充值**：`POST /api/billing/orders`（1–1000 元、整数分、`alipay` / `wechat`）与 `POST /api/billing/orders/{id}/query` 主动查单。支付宝返回签名付款链接，微信返回 `code_url` 由前端生成二维码（依赖 `qrcode`）。**页面回跳或前端声称成功都不入账**，只有验签通过的通知或查单结果在同一事务里更新订单、余额与唯一账本引用。
- **部署**：新增迁移 `b1c2d3e4f5a6`（计费四表）、补列迁移 `b2f9e8d7c6a5`（调用单价快照）与 `c3a1b2c3d4e5`（积分三表），`alembic upgrade head` 一并应用。配置样例见 `backend/.env.billing.example`，**只在后端读取，不要写进 `VITE_` 变量**。
- **未实现**：退款、自动关单、商户对账下载、管理后台。仓库里没有任何真实模型价目与支付凭据，默认 `BILLING_PAYMENTS_ENABLED=false`，不能收款，也未发生真实收款或付费调用。

完整口径（验签、精度、并发与失败边界）见 [docs/platform-billing.md](docs/platform-billing.md)。

### 平台积分（试运行，默认关闭）

与平台余额并存的第二套计量方式，**独立账本、不与元余额互相兑换**：元余额走 `billing_*` 四表，积分走 `credit_lots` / `credit_calls` / `credit_ledger` 三表。切换方式仍是 `PUT /api/credits/preferences` 把 `mode` 设为 `platform`、`modelId` 设为 `credits:deepseek-flash`。

- **接口**：`GET /api/credits/catalog`（可用模型、单价、套餐展示位）、`GET /api/credits/account`（可用 / 预留微积分、批次明细、最近 30 条流水）、`PUT /api/credits/preferences`（只接受 `credits:deepseek-flash`，其他模型返回 503）。
- **计费口径**：1 积分 = 1,000,000 微积分；单次费用 = 输入 token × 40 + 输出 token × 160，合计向上取整到 1 微积分。调用前按上限（16,000 输入 / 4,096 输出）预留，拿到可核验 usage 后按实际量扣、剩余释放；缺 usage、超时、空响应不扣费，预留 10 分钟未结算自动释放。
- **免费额度**：每个用户每月 500 积分，按北京时间自然月发放，月末到期不结转。
- **模型约束**：固定 `deepseek-flash`，非流式、关闭思考模式，只支持文本。图片识题、资料对比与资料任务、简历润色仍只认自带 Key。
- **启用条件**：`CREDITS_DEEPSEEK_ENABLED=true` 且 `BILLING_PROVIDER_KEYS_JSON` 里有 `deepseek` 的 Key，缺任一项目录为空、切换被拒。Key 只在后端读取。
- **未实现**：购买、开通、自动续费、退款全部没有开放 —— 目录里的免费 / 启航 / 补给三档 `purchaseAvailable` 恒为 `false`，积分数量与价格只作展示。试运行期间的测试积分由运维在本地执行发放函数产生，**不是付款记录**，也不代表已上线付费订阅。

### 自带 API Key（高级设置）

**唯一事实来源是个人中心**「API 调用与模型配置」，接口 `/api/api-config`（`GET / POST / PUT / PATCH / DELETE`，外加 `POST /api/api-config/models`）。

配置步骤：

1. 填 Base URL（必须以 `http://` 或 `https://` 开头；DeepSeek 填 `https://api.deepseek.com`，误填 `platform.deepseek.com` 会被后端纠正）；
2. 填 API Key（明文只在内存，不写 localStorage）；
3. 拉模型列表 —— `POST /api/api-config/models`，优先用表单里的草稿 Key + URL，缺哪项就用已存配置补；供应商不支持 `/models` 时列不出来，需手填模型名；
4. 选模型、保存。**保存即真实校验**（默认走供应商 `/models`，不能用 HTML 控制台页面蒙混通过），通过后 `isVerified=true`。

生效与同步行为：

- **生效时机**：保存成功立刻生效，不用重启服务。使用方式为「自带 API Key」时，所有 AI 调用（助手、规划、诊断、练习判分、OCR、简历润色）只取 `isVerified=true` 的配置，未验证等于没配；切到平台余额后，助手、规划、诊断、练习这四项改由平台网关按用量扣余额，不再读这份 Key 配置，OCR 与简历润色仍只认 Key。
- **保存方式**：Key 加密入库（AES-256-GCM，`AES_KEY` 派生），读接口只回 `apiKeyMasked`（末 4 位）；换设备、清缓存后重新登录仍在。
- **前端本地只存非敏感偏好**：模型代号与推理强度（`studypilot.modelPrefs.v1`），不存 Key。
- **不同聊天入口的配置来源**：
  - 主聊天面板（`ChatPanel`）与悬浮小窗（`ChatWindow`）共用 `useAssistantChat`，都打 `/api/assistant/chat`，凭证由后端 `resolve_credential` 解密后只在出站请求头里使用，前端全程拿不到明文；
  - 内嵌简历编辑器（`/resume/practical` 的 iframe）**不直接持有 Key**：个人中心把已验证配置投影成一条哨兵配置（`apiKey: '__STUDYPILOT_MANAGED__'`）写进它自己的 `ai-config-storage`，真实请求走 `/api/ai-test`、`/api/grammar`、`/api/polish`、`/api/models`，由后端换成个人中心凭证。
- **投影时机**：进个人中心读到配置时投影一次；保存 / 更新成功后再次投影；无配置或未验证则清空简历侧配置；进简历页时在 iframe 挂载前再同步一次（网络或鉴权失败时不清空，避免短暂离线冲掉已同步配置）。

## 数据统计与学习诊断

**指标区**（`/api/statistics/overview`）：四张带图标的指标卡 —— 累计作答（已判分习题）、学习天数（有打卡的日期）、上传资料（知识库文档）、错题收录（错题本条目）。

**「近 30 日作答量」**：堆叠柱状图，每根柱按 correct / partial / wrong 三段拆分，与右侧掌握度环图同一套配色；柱下方另有一根独立基线表示「新增错题」，是两个指标，不是第四段作答。

**七个明细面板**：阶段双环、近 30 日作答量、掌握度分布、高频错题 TOP5、近 30 日练习日历、学习航线、正反馈与顺延。点任一标题进入单面板详情（其余面板收成底部缩略条），「收起详情」回到两列网格。练习日历面板固定展开，不进入单面板详情，也不出现在底部缩略条里。

**「近 30 日练习日历」**（`PracticeCalendar`，替代原来的星图）：

- 30 个格子按**周一至周日**排列，前后补空位；日期以北京时间（`Asia/Shanghai`）为准，不受浏览器时区影响；今天有 `aria-current="date"`。
- 点任一日期打开当天详情弹窗，数据来自 `GET /api/statistics/practice-days/{YYYY-MM-DD}`，按北京时间当天 00:00 至次日 00:00（不含）取 `MasteryEvidence`。
- 得分口径：**正确 100、部分掌握 50、错误 0** 折算到 100 分，界面写明「仅反映已记录的练习证据，不等同于正确率或整体能力」；当天无证据显示「暂无练习证据」，休息和线下学习不会被记成未掌握。
- 明细最多展示最近 100 条，超过时明确提示「共 N 条，展示最近 100 条，上方统计仍包含当天全部证据」；样本少于 5 条会提示结合原题回看。读取失败显示重试按钮，不显示猜测值。
- 弹窗底部「打开习题本」只跳转已有题目，**不按所选日期筛选**，界面已注明。

**周报**：`/api/weekly-reviews/latest`，无记录时惰性生成；总览的「最近周报」档与统计页共用同一份摘要。

**学习诊断**（`POST /api/statistics/diagnosis`）：

- 证据来自 `MasteryEvidence`（全时段结果分布 + 最多 100 条最近证据），没有判分记录会直接拒绝（`NO_PRACTICE_DATA`），不生成空报告；
- 报告生成后**落库为一条会话**（`context_type='free'`，`citations.kind='learning_diagnosis_v1'`），所以能持久保存、能改名、能翻历史，不是一次性弹窗；
- **三段玻璃滑块**：最新报告（`/diagnosis/latest`）、历史报告（`/diagnosis/history`，按生成时间倒序）、搜索报告；
- **历史列表折叠**：再次点击「历史报告」即收起列表，只留报告正文；
- **搜索**：按报告名字 + 北京时间日期（`Asia/Shanghai`）匹配，本地过滤已拉取的历史；
- **改名**：每行的铅笔图标展开输入框，1–64 字符，写回会话标题（`PATCH /api/conversations/{id}`），刷新后仍是新名字。

## 语音朗读与小助手

小助手（悬浮球点开的小窗，与主聊天面板是同一套会话逻辑）的回复可以朗读。

- **音色**：微软 `zh-CN-XiaoxiaoNeural`（晓晓）在线女声。不回退到系统合成音色。
- **语音服务**：`speech/synthesize.py` 读 stdin 里的单段文本，用 `edge-tts==7.3.1` 流式输出 MP3。它跑在独立环境 `speech/.venv-edge` 里，由后端 `/api/speech/*` 以子进程调用 —— **不需要单独启动语音服务**，启动 StudyPilot 即可。
- **自动预生成**：新回复**完整生成后**，前端把该条**正文**（去掉 Markdown 标记）按句拆段发到 `POST /api/speech/prewarm`。这会**把正文发送给实际使用的在线语音服务（微软 edge-tts）**，不是纯本地合成。预生成不自动播放；历史回复不会因为打开面板而批量上传，只有点朗读才生成。
- **资料来源与引用被排除**：朗读与预生成只取消息正文，`message.citations` 里的资料来源、文档摘录、引用卡片都不发送。
- **流式朗读**：`POST /api/speech/playback` 先换一个 120 秒、绑定当前用户的短期播放凭证，再 `GET /api/speech/playback/{token}` 流式取 MP3，收到首段即开始播，不等整段合成完。播放地址里不含正文。
- **缓存与共享**：已完整生成的音频按用户隔离缓存在后端内存，15 分钟过期、上限 16 MiB / 128 段，不落盘。主聊天与小窗打的是同一组接口，切来切去能复用同一份缓存。
- **限制**：单段文本 ≤ 300 字符（前端按 280 字符、优先在句末标点切句），单段音频 ≤ 8 MiB，同时只有 2 个合成槽，槽满 0.5 秒内返回 429。
- **停止**：点停止会取消后续请求并断开音频流，后端杀掉当前子进程、释放并发槽。
- **速度**：缓存命中或预生成已完成时可以快速出声；未缓存内容的首次播放仍需网络握手和上游生成，**不保证 1 秒内出声**。
- **缺件降级**：`speech/.venv-edge` 不存在时接口返回 503 `SPEECH_UNAVAILABLE`；固定问候音频 `speech/output/greeting-xiaoxiao.mp3` 被 `.gitignore` 排除，不在仓库里，缺失时只有开场问候无声，正文朗读不受影响。
- **发送范围**：只发被朗读的那一段正文。不发聊天历史、不发上传资料、不发其他消息。

### 助手人物（companion）

悬浮的助手人物是项目内组件（`components/assistant/FloatingIcon.tsx`），不是外部插件：

- **交互**：拖动头像可改位置；**单击**开 / 关聊天（鼠标点击延迟 450 ms 等待双击判定，键盘激活立即生效，拖动结束不误触聊天）；**双击**展开全身人物；全身右上角「收起」回到小头像，「展开」再恢复。锚点与收起偏好存 `localStorage`（`studypilot.companion.anchor` / `studypilot.companion.collapsed`），刷新后保持。
- **默认形态**：没有保存过偏好时，宽度小于 768 px 默认收起成小头像，桌面默认展开。
- **避让**：小头像与 `main` 内的按钮、输入框、标题等可见控件重叠时自动上移，且不越出视口；页面有 `dialog[open]` 或 `aria-modal` 弹窗时人物让位隐藏，弹窗关闭后恢复。展开是显式选择，DOM 变化不会把它自动收回去。
- **资源**：`frontend/public/assistant/companion-avatar.png`（小头像）；全身人物沿用 `chat-girl-*` 素材（图片 / 视频帧）。系统开启「减少动态效果」时停止逐帧播放，只保留静态形象，并立即结束入场 / 说话状态。

## Roadmap 学习资源

每日任务可以带一条 `resourceUrl`，指向具体课程页或视频页。

- **只收具体页**：主机必须在白名单内（B 站、中国大学 MOOC、学堂在线、智慧树、超星、网易公开课、Coursera、知乎、研招网、`edu.cn`、`ac.cn`、`mit.edu`、国家高等教育智慧教育平台、人邮 MOOC 等，见 `backend/app/services/resource_links.py`），且路径必须落到具体内容：B 站只认 `/video/BV…` 或 `/video/av…`，其他平台只认 `/video|/course|/learn|/lecture|/lesson|/training|/courseHome/…`。**平台首页、栏目页、搜索页一律丢弃**，任务描述保留。
- **旧任务只读补全**：读取每日任务或阶段详情时，若存量任务没有链接，后端按任务描述去本地课程库元数据里匹配课程名与章节目录，命中就补出链接和章节 / 小节标题（`direction_service.task_resource_fields`）。**只影响响应，不改库、不改快照**。匹配不到就留空，不编链接。
- **前端也过滤**：`TaskResourceLink` 用 `isConcreteResourceUrl` 再挡一次旧数据里的首页链接，无效链接不渲染。

诚实边界：不保证每个任务都有视频；补链靠本地课程库元数据匹配，不是逐条联网核验；链接可达也不代表内容与任务严格对应。

## 技术栈

**前端** —— React 18 · TypeScript 5 · Vite 5 · Tailwind CSS 3 · framer-motion · GSAP + Lenis · Rive · three（按需）· zustand · lucide-react · jsPDF · qrcode（微信充值的二维码）
**后端** —— FastAPI · SQLAlchemy 2 · Alembic · Pydantic Settings · SQLite（默认）/ MySQL
**AI 接入** —— 兼容 OpenAI 风格的 Chat Completions 与 `/models` 接口（DeepSeek 已实测，含 `reasoning_content` 兼容）；另有一条服务端计量网关，按真实 usage 扣平台余额
**语音** —— edge-tts 7.3.1（晓晓在线女声），独立 venv，不在后端 requirements 里
**测试** —— pytest + Hypothesis（属性测试）· Vitest + fast-check

## 目录结构

```
study-pilot/
├── backend/
│   ├── app/
│   │   ├── core/        # 配置、数据库、AES-GCM 加解密
│   │   ├── models/      # SQLAlchemy 实体
│   │   ├── routers/     # REST + SSE 路由（含 speech / resume_ai / statistics / billing）
│   │   └── services/    # 业务逻辑（规划、助手、诊断、指标、复盘、资源链接、计费网关…）
│   ├── alembic/         # 数据库迁移
│   ├── tests/           # pytest + Hypothesis 属性测试
│   ├── .env.example
│   └── .env.billing.example  # 平台余额与支付配置样例（全空即关闭）
├── frontend/
│   ├── src/
│   │   ├── components/  # 通用组件、总览三件套、统计与诊断、聊天/小窗
│   │   ├── pages/       # 总览 / Roadmap / 习题本 / 数据统计 / 简历 / 个人中心
│   │   ├── lib/         # httpClient、各领域 API 封装、语音与配置桥接
│   │   ├── store/       # zustand 状态
│   │   └── mocks/       # 类型与演示数据兜底
│   ├── public/resume-site/  # 内嵌简历编辑器（本地镜像）
│   └── .env.example
├── speech/              # 晓晓语音客户端（synthesize.py / setup.ps1 / 独立 venv）
├── data/                # 方向、岗位与课程库元数据（JSON）
├── scripts/             # 素材处理、端口清理与诊断脚本
├── start-all.bat        # 一键起前后端
└── DEPLOY.md            # 部署与演示清单
```

**请求链路**：前端 `lib/httpClient` → Vite 代理 `/api` → FastAPI 路由 → service 层 → SQLAlchemy；AI 相关接口经 `ai_proxy` 调用供应商，密钥在出口前解密。

## 前后端环境与复现

### 环境要求

- Python 3.13（后端与语音环境都用它建 venv）
- Node 18+（开发机实际使用 Node 22）
- Windows 可直接用 `start-all.bat`；Linux / macOS 按下面命令手动起

### 后端环境变量（`backend/.env`）

| 变量 | 必需 | 默认 | 说明 |
|---|---|---|---|
| `DATABASE_URL` | 是 | 无 | SQLAlchemy 连接串。开发用 `sqlite:///./studypilot.db` |
| `DB_PASSWORD` | 是（可留空） | 无 | MySQL 部署才需要真实值；SQLite 留空但变量本身要在 |
| `AES_KEY` | 是 | 无 | base64 编码的 32 字节，用于加密存储用户 API Key。留空会在加解密时报错 |
| `SESSION_TIMEOUT_MINUTES` | 否 | `30` | 会话有效期（分钟） |
| `BILLING_*` | 否 | 全空 / `false` | 平台余额与充值配置，样例见 `backend/.env.billing.example`。不填即目录为空模型、支付渠道不可用、不能收款 |
| `CREDITS_DEEPSEEK_ENABLED` | 否 | `false` | 平台积分开关，还要 `BILLING_PROVIDER_KEYS_JSON` 里有 `deepseek` 的 Key 才真正可用。关闭时积分目录为空、切换被拒 |

`DATABASE_URL`、`DB_PASSWORD`、`AES_KEY` 在 `Settings` 里没有默认值，缺任一项启动即失败 —— 这是有意的：宁可启动报错，不要用空密钥跑起来。

`BILLING_*` 是另一组独立配置（`BILLING_MODELS_JSON`、`BILLING_PROVIDER_KEYS_JSON`、`BILLING_PAYMENTS_ENABLED`、支付宝 / 微信商户字段），全部有安全默认值，缺省不影响基础功能。**这些字段只在后端读取，不要写成 `VITE_` 变量**，否则密钥会进前端包。

### 前端环境变量（`frontend/.env`）

| 变量 | 必需 | 默认 | 说明 |
|---|---|---|---|
| `VITE_API_BASE_URL` | 否 | 空 | 留空即走 Vite 代理 `/api` → `127.0.0.1:8000`；生产同域反代也留空；前后端分域时才填公网 API 根（勿带尾斜杠） |

### 端口与代理

| 项 | 值 |
|---|---|
| 后端 | `127.0.0.1:8000`（`/health` 探活） |
| 前端 | `127.0.0.1:5173` |
| 代理 | Vite `server.proxy['/api'] → http://127.0.0.1:8000`，`changeOrigin: true` |
| 会话 | 同域 Cookie，跨域需自行补 CORS 与 `SameSite` |

### 启动

```bash
# 后端
cd backend
cp .env.example .env          # 填 DATABASE_URL / DB_PASSWORD / AES_KEY
py -3.13 -m venv .venv
.venv/Scripts/activate        # Linux/macOS 用 source .venv/bin/activate
python -m pip install -r requirements.txt
python -m alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# 前端（另开一个终端）
cd frontend
npm install
npm run dev
```

`AES_KEY` 生成：

```bash
python -c "import base64,os;print(base64.b64encode(os.urandom(32)).decode())"
```

### 语音环境（要朗读才需要）

```powershell
# 在仓库根目录执行；会建 speech/.venv-edge 并装 edge-tts
powershell -ExecutionPolicy Bypass -File speech/setup.ps1
```

不装也能跑完除语音外的全部功能，只是朗读接口返回 503。

`setup.ps1` 只有 Windows 版（用 PowerShell 建 venv）。Linux / macOS 手动建到同一路径即可：`python -m venv speech/.venv-edge && speech/.venv-edge/bin/pip install -r speech/requirements.txt`（后端在 Windows 取 `Scripts/python.exe`，其他平台取 `bin/python`）。

### 一键启动

双击仓库根目录 `start-all.bat`：检查 `.venv` 与 `.env`、缺 `node_modules` 时先装依赖、清理 8000 / 5173 残留进程、开两个窗口（后端先跑 `alembic upgrade head` 再 `--reload`，前端 `--strictPort`），轮询到前端 200 后自动开浏览器。

## 10 分钟极速复现指南

目标：干净机器上从零到「上传资料 → 生成计划 → 做题 → 看诊断」的最小闭环。

> **耗时未在本轮重新实测。** 下面步骤已按当前代码逐条核对，但不附带本轮计时的结论；实际耗时取决于网络（`pip` / `npm` 下载、是否装语音环境）与是否已有 AI Key。

1. 装 Python 3.13 与 Node 18+；
2. `git clone` 后进仓库根目录；
3. `cd backend && cp .env.example .env`，生成并填入 `AES_KEY`（`DATABASE_URL` 保持 SQLite 默认，`DB_PASSWORD` 留空）；
4. `py -3.13 -m venv .venv` → `.venv/Scripts/activate` → `pip install -r requirements.txt` → `python -m alembic upgrade head`；
5. `uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`，访问 `/health` 确认 200；
6. 另开终端 `cd frontend && npm install && npm run dev`，打开 `http://127.0.0.1:5173`；
7. 注册 → 个人中心填 API Key / Base URL / 模型并保存（保存即校验）→ 上传一份 PDF/DOCX/TXT/MD → 助手提交目标生成计划 → 总览打卡 → 数据统计生成一份学习诊断。

不需要 Key 也能走到的部分：注册登录、资料上传与解析、任务与打卡、错题本、统计页的打卡类指标。需要 Key **或平台余额 / 积分**的部分：规划生成、助手对话、判分、诊断；图片识题与简历润色只认自带 Key。

语音朗读是可选项，第 8 步之外单独执行 `speech/setup.ps1`。

## 测试

```bash
# 后端：内存 SQLite + 注入的 mock 生成器，不发起任何外部 AI 调用
cd backend
.venv/Scripts/python.exe -m pytest -q

# 前端
cd frontend
npm run test          # Vitest
npm run build         # tsc -b && vite build（类型检查只在 build 阶段生效）
```

**后端基线不是全绿。** 2026-10-29 于 `d49fab3` + 未提交计费批次实测：**2 failed，其余通过**。那 2 条固定是 `tests/test_video_link.py::test_bilibili_metadata_can_be_read_when_local_dns_is_unavailable` 的两个参数化用例，依赖真实 bilibili DNS，非回归。通过数随功能增长，以实跑为准，别抄旧数字。

前端 `tsc -b` 目前仍被 19 条**既有测试文件**的类型错误阻断（`AssistantNamePrompt`、`planner/*`、`adjustmentPreviewActions`），与产品源码无关；`npm run build` 因此失败，但 Vite 产品打包可单独跑通。不要把这些错误算成本轮回归，也不要用改测试的方式凑绿。

必须用 `backend/.venv` 的 Python：系统 Python 的 `bcrypt` 与 `passlib` 不兼容，会得到上百条假失败。

后端属性测试（Hypothesis）每条属性至少迭代 100 次，用例注释中的 `Feature: study-pilot, Property N` 对应 `.kiro/specs/study-pilot/design.md` 的 Correctness Properties 表。

## 部署

见 [DEPLOY.md](DEPLOY.md)。要点：

- 推荐 **同域反向代理**（Nginx / Caddy：`/` → `frontend/dist`，`/api` → 后端），避免跨域丢 Cookie；
- 构建前端 `npm run build`，产物在 `frontend/dist`；
- 若前后端不同域，需额外配置 CORS 与 `SameSite=None; Secure`；
- `frontend/public/resume-site/` 的内嵌简历编辑器按站点根路径取资源，静态托管时要把 `/zh`、`/en`、`/app/*`、`/assets/*`、`/fonts/*`、`/landing/*` 反代到 `/resume-site/`（`vite.config.ts` 的开发 / 预览插件已处理，`DEPLOY.md` 给了 nginx 片段）；
- 语音依赖 `speech/.venv-edge` 与出网访问上游语音服务，部署机上要单独跑一次 `speech/setup.ps1`。

## 项目文档

- `.kiro/specs/study-pilot/` —— 需求、设计与任务分解（Kiro spec）
- [docs/platform-billing.md](docs/platform-billing.md) —— 平台余额：目录配置、计费精度、预留与结算、支付验签与失败边界
- [DEPLOY.md](DEPLOY.md) —— 本地联调、公网部署、竞赛演示主路径与手动验收清单

## 说明

本项目为课程设计 / 竞赛作品，仅供学习与研究使用。

## 仓库历史说明

项目前期（9 月下旬至 10 月 2 日）在本地用 Kiro 做需求和设计、用 WorkBuddy 和 Cursor 迭代实现，过程记录在 `.kiro/specs` 和各工具的会话日志中，技术文档给出了整理后的 Prompt 链。

10 月 2 日首次把代码推送到远程仓库：`5cb6bd2` 加入项目骨架，`48ce6ba` 导入当时已有的前后端代码和文档。随后一个定时任务以另一个作者邮箱把同一批内容又提交了一次（`91e5129`，与 `48ce6ba` 内容完全相同），在 `840e057` 合并，这两条是同一批代码。

此后按功能小步提交，每次提交对应一个功能点或一轮 AI 对话。已推送的历史不做改写。

10 月 13–14 日定位转型期间，有 3 个提交（`d096d6c`、`8fc9ee4`、`bda1559`）的信息里用了过渡期名称「智航」。该名称当天即弃用，产品名定为 StudyPilot；随后 `6947b9c` 的提交信息记录了这次弃用。此后提交不再出现该名称。已推送的历史不改写。
