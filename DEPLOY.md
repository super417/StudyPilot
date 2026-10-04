# StudyPilot 部署与演示说明

## 本地联调

1. 后端（`study-pilot/backend`）
   - 复制环境变量并填写 `DATABASE_URL`、`AES_KEY`、`DB_PASSWORD` 等
   - `uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`
   - 健康检查：`GET http://127.0.0.1:8000/health`

2. 前端（`study-pilot/frontend`）
   - `cp .env.example .env`（开发可留空 `VITE_API_BASE_URL`）
   - `npm install && npm run dev`
   - Vite 已将 `/api` 代理到 `127.0.0.1:8000`，Cookie 会话同域可用

或双击根目录 `start.bat` 仅启动前端；后端需另行启动（推荐 `backend/start.bat`）。

## 公网部署建议

- **推荐同域反代**：Nginx/Caddy 将 `/` → 前端静态，`/api` → 后端，避免跨域丢 Cookie
- 若前后端不同域：需后端配置 CORS + Cookie `SameSite=None; Secure`（**当前后端未改契约，优先同域**）
- 构建：`npm run build`，产物在 `frontend/dist`
- 环境变量：构建时注入 `VITE_API_BASE_URL`（同域反代时留空即可）

## 竞赛演示主路径

1. 注册 / 登录  
2. 个人中心配置并验证 AI API（DeepSeek Base URL 填 `https://api.deepseek.com`，勿填 platform 控制台）  
3. 「选择模型」按 API `/models` 动态加载；推理强度会作用于助手与规划  
4. 学习资料上传考研讲义（PDF/DOCX/TXT/MD）  
5. 助手日历 → 提交学习目标（真实规划 SSE：clarify / notice / done）  
6. 总览打卡 → 刷新今日三态与路线洞察板块  
7. Roadmap：`GET /api/plans/latest` 展示阶段；本周任务可切换完成态  
8. 错题本查看 / 改复习状态；周报查看或空态  
9. 故意输入娱乐类问题 → 见领域拦截提示（非伪造 AI）

## 能力状态

| 能力 | 状态 |
|------|------|
| `POST /api/assistant/chat` | ✅ SSE token/error/done；领域拦截；文档 RAG 摘录；推理强度透传；思考链不进回复 |
| `POST /api/api-config/models` | ✅ 代理供应商 `/models`；DeepSeek platform 主机自动纠正 |
| `GET /api/plans/latest` | ✅ 最新规划 + 阶段列表 |
| `GET /api/weekly-reviews/latest` | ✅；无记录时惰性生成上周/本周；掌握度按课程科目的本周任务完成比例现算 |
| `GET /api/documents` | ✅ 按 docId 聚合用户文档清单；前端水合 |
| 个人中心右栏 | ✅ 今日待办←daily-tasks；动态←文档/规划/错题/周报派生；无假流水 |
| `POST /api/mistakes` | ✅ 手动录入错题；默认 pending 进复习队列；标「已安排」按 1/2/4/7/15/30 天、之后翻倍排下次复习 |
| `POST /api/mistakes/ocr` | ✅；错题本「拍照 / 上传图片」识别题目，走设置里的模型，需支持识图（GPT-4o、Gemini 等） |
| 课程章节 | ✅；一门课可加网页链接（视频或课程页），学完打勾。链接由用户填写，不编造地址 |

## API 配置与真实调用

1. 个人中心填写 **API Key / Base URL / 模型**（DeepSeek：`https://api.deepseek.com`）  
2. 保存时后端校验；密钥加密入库  
3. 规划：`POST /api/plans/generate` → Ai_Proxy 调模型；解析失败则确定性考研骨架兜底  
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
