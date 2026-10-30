# StudyPilot 部署与演示说明

## 本地联调

1. 后端（`study-pilot/backend`）
   - 复制环境变量并填写 `DATABASE_URL`、`AES_KEY`、`DB_PASSWORD` 等
   - 首次安装依赖后，在 backend 目录执行 `.venv/Scripts/python.exe -m alembic upgrade head`，升级前备份已有数据库
   - 先跑种子脚本 `.venv/Scripts/python.exe -m scripts.seed_review_user`，再启动后端
   - `.venv/Scripts/python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`
   - 健康检查：`GET http://127.0.0.1:8000/health`

2. 前端（`study-pilot/frontend`）
   - `cp .env.example .env`（开发可留空 `VITE_API_BASE_URL`）
   - `npm install && npm run dev`
   - Vite 已将 `/api` 代理到 `127.0.0.1:8000`，Cookie 会话同域可用

或双击根目录 `start-all.bat` 一键启动前后端：自动跑 alembic 迁移、清理 8000/5173 残留进程、开两个窗口（后端 `--reload`、前端 `--strictPort`）并在 6 秒后打开浏览器。只想单独起某一个服务时，按上面 1 / 2 节手动执行命令。

## 公网部署建议（可选，不属于本次评委主路径）

- **推荐同域反代**：Nginx/Caddy 将 `/` → 前端静态，`/api` → 后端，避免跨域丢 Cookie
- 若前后端不同域：需后端配置 CORS + Cookie `SameSite=None; Secure`（**当前后端未改契约，优先同域**）
- 构建：`npm run build`，产物在 `frontend/dist`
- 环境变量：构建时注入 `VITE_API_BASE_URL`（同域反代时留空即可）

### 「实用简历管理」内嵌编辑器

`frontend/public/resume-site/` 是本地内置的简历编辑器（源自开源 Magic Resume，已改品牌文案、去掉 GitHub 入口），
页面用 iframe 指向 `/zh`。该应用按站点根路径取资源并做无扩展名路由，因此：

- `npm run dev` / `npm run preview`：由 `vite.config.ts` 里的 `studypilot-resume-site-mirror` 插件把
  `/zh`、`/en`、`/app/*`、`/assets/*`、`/fonts/*`、`/landing/*`、`/template-snapshots/*` 及根级图片
  映射到 `public/resume-site/`（支持目录索引与动态路由回落），无需额外配置。
- 纯静态托管（nginx）：需把上述前缀反代到 `/resume-site/` 并开启目录索引，例如

  ```nginx
  location ~ ^/(zh|en|app|assets|fonts|landing|template-snapshots)(/|$) {
      rewrite ^/(.*)$ /resume-site/$1 break;
      root /srv/studypilot/dist;
      index index.html;
      try_files $uri $uri/index.html $uri.html =404;
  }
  ```

## 本地评委体验（不需要个人 Key）

本次交付采用本地运行，不要求公网地址。后端仍需联网访问模型供应商；本地运行不等于离线 AI。前端使用 `http://127.0.0.1:5173`，后端使用 `127.0.0.1:8000`，保持 Vite 的 `/api` 代理。

运维先完成依赖安装、数据库备份和 `alembic upgrade head`，再运行 `.venv/Scripts/python.exe -m scripts.seed_review_user`，然后启动后端。在 backend 私有 `.env` 配置：

```dotenv
CREDITS_DEEPSEEK_ENABLED=true
BILLING_PROVIDER_KEYS_JSON={"deepseek":"<服务端真实API Key>"}
CREDITS_REVIEW_USER_ID=4c6d1df3-95a2-472f-9018-34bf11db3efe
CREDITS_REVIEW_UNTIL=2027-10-30T00:00:00+08:00
```

以上固定 UUID 与种子脚本一致；Key 为占位，须由运维填写，不能放进前端变量或提交到仓库。评委使用 `super` 账号登录即可，无需输入个人 Key；种子新建账号的初始密码为 `StudyPilot2026!`，脚本不会重置已有账号密码。当前本机评审资格配置为截至 **2027-10-30 00:00:00（北京时间，不含该时刻）**，与当前准备的一年体验期对应；克隆仓库不会携带私有账号、密钥或此机器的数据库，另一台机器需要自行配置或按受控方式恢复。

资格有效期内，每月首次读取账户或使用积分模型时，按现有 UUID 自动赠送启航版测试包（基础 2,000 + 赠送 2,000 积分）。同月重复读取不重发，旧批次保留，新增批次在月末与资格截止的较早时刻到期。账本标作测试赠送，不代表购买、付款或订阅。普通免费账号只有每月 5 轮助手聊天，不能用该免费次数完成规划、出题和判分。

评委操作：

1. 登录 `super`，个人中心检查可用积分与到期时间，选择 DeepSeek 平台积分模型并点击启用。
2. 上传一份真实 PDF/DOCX/TXT/MD 资料，提交学习目标生成规划。
3. 完成对应任务并打卡，生成练习、作答、提交判分，查看原题与判分依据。
4. 满足真实补强条件时，查看候选与依据，确认后在计划中核对新任务；没有候选时如实记录，不改阈值制造结果。
5. 可继续补强重测，核对结果。已有数据属于历史学习案例，不冒充本次刚完成的操作。

多人使用 `super` 会共用学习记录和积分；不同浏览器会话不是不同数据空间。不要删除、覆盖其他评委的计划、答案或资料。积分忙碌时等待后手动点击重试，勿连续重复提交。模型超时/上游失败会释放预留，保留已保存题目与历史判分；恢复后可手动重试。上游返回有效文本及可核验用量、但业务解析失败的情况仍可能结算实际用量，不承诺所有业务失败都免费。

自带 Key 为可选替代：个人中心高级设置填写 API Key / Base URL / 模型，保存验证后切换。自带 Key 由供应商直接计费，不消耗平台免费次数或积分。图片识题、简历润色当前仍需自带 Key，不能将平台积分支持范围扩大描述到这些能力。

本节描述操作与配置要求；真实模型 UI 端到端结果由本轮交付验收记录另行给出，不以文档步骤代替实测。

## 能力状态

| 能力 | 状态 |
|------|------|
| `POST /api/assistant/chat` | ✅ SSE token/error/done；领域拦截；文档 RAG 摘录；推理强度透传；思考链不进回复；可给通用学习建议（不编造链接与出处） |
| `POST /api/api-config/models` | ✅ 代理供应商 `/models`；DeepSeek platform 主机自动纠正 |
| `GET /api/plans/latest` | ✅ 最新规划 + 阶段列表 |
| `GET /api/weekly-reviews/latest` | ✅；无记录时惰性生成上周/本周；掌握度按课程科目的本周任务完成比例现算 |
| `GET /api/documents` | ✅ 按 docId 聚合用户文档清单；前端水合 |
| 个人中心右栏 | ✅ 今日待办←daily-tasks；动态←文档/规划/错题/周报派生；无假流水 |
| `POST /api/mistakes` | ✅ 手动录入错题；默认 pending 进复习队列；标「已安排」按 1/2/4/7/15/30 天、之后翻倍排下次复习 |
| `POST /api/mistakes/ocr` | ✅；错题本「拍照 / 上传图片」识别题目，走设置里的模型，需支持识图（GPT-4o、Gemini 等） |
| 课程章节 | ✅；一门课可加网页链接（视频或课程页），学完打勾。链接由用户填写，不编造地址 |
| `GET/PUT /api/resume-documents` | ✅；简历编辑器快照按账号保存（一人一份，≤4MB），前端进页先合并再挂载 iframe，编辑后 4s 内回写，换设备/清缓存可恢复 |
| 每日任务资源链接 | ✅；规划生成的每日任务可带 `resourceUrl`，只接受白名单平台域名（B 站 / 中国大学 MOOC / 学堂在线 / 研招网 / 高校域名等，见 `services/resource_links.py`）。名单外的链接直接丢弃、任务描述保留。助手里问「找课程 / 推荐网课 / 学习路径」会走 regenerate 把资源排进每日任务 |

## API 配置与真实调用

1. 个人中心填写 **API Key / Base URL / 模型**（DeepSeek：`https://api.deepseek.com`）  
2. 保存时后端校验；密钥加密入库  
3. 规划：`POST /api/plans/generate` → Ai_Proxy 调模型；解析失败则确定性兜底骨架  
4. 闲聊：`POST /api/assistant/chat` 真实 SSE；携带 `reasoningStrength`

## 验证命令

```powershell
# frontend
npm run typecheck
npm run test
npm run build

# backend（务必用 backend/.venv）
.\.venv\Scripts\python.exe -m pytest tests -q
```

## 任务 23 · 第五阶段手动联调清单

请按顺序走通（真实 AI Key）：

1. [ ] 注册 / 登录；刷新后会话仍在  
2. [ ] 个人中心配置并验证 API（DeepSeek：`https://api.deepseek.com`）  
3. [ ] 选择模型列表从 `/models` 动态加载；调节推理强度  
4. [ ] 上传 PDF/DOCX/TXT/MD；个人中心资料清单可见  
5. [ ] 助手日历提交目标 → 规划 SSE（clarify / notice / done）  
6. [ ] 总览打卡 → 今日三态与指标刷新  
7. [ ] Roadmap 看阶段；切换本周任务完成态  
8. [ ] 错题本列表 / 详情 / 复习状态；周报有或空态合理  
9. [ ] 娱乐类提问 → 领域拦截（非假 AI）  
10. [ ] 演示首屏导航 → 各 Tab；聊天记录抽屉可用  

自动化基线：前端 `npm run test`（22.4）；后端 `pytest`（vvenv）。
