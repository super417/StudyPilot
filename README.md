# StudyPilot

> 基于证据链与 Agent 工作流的考研科研成长助理。

上传你的讲义与目标，Agent 会读取资料、生成一份可迭代的学习计划，并把它落到每一天的任务、打卡、错题与周复盘上。

---

## 它解决什么问题

考研备考的痛点是「计划定不下来、定了执行不下去、执行完看不出进展」。StudyPilot 把这三件事串成一条闭环：

1. **规划** —— 提交目标 + 上传讲义（PDF / DOCX / TXT / MD），AI 结合资料内容生成分阶段计划；
2. **执行** —— 计划拆到每日任务，打卡记录时长与状态，支持中途调整阶段；
3. **复盘** —— 错题本沉淀薄弱点，周复盘与指标总览回答「我这周到底推进了多少」。

## 功能一览

| 模块 | 说明 |
|---|---|
| 账号与会话 | 注册 / 登录 / 登出，服务端 Cookie 会话，密码 bcrypt 哈希 |
| AI 配置 | 个人中心填写 API Key / Base URL / 模型；Key 经 AES-256-GCM 加密入库，模型列表由供应商 `/models` 动态拉取 |
| 学习资料 | 上传 PDF / DOCX / TXT / MD，后端解析为文本供规划与问答检索 |
| 目标与规划 | 对话式提交目标 → SSE 流式生成计划（clarify / notice / done 事件）；支持整体重新生成与单阶段微调 |
| Roadmap | 展示最新计划的阶段划分与进度，切换本周任务完成态 |
| 每日任务与打卡 | 今日任务列表、打卡记录学习时长、今日三态（未反馈 / 已安排 / 已完成） |
| 错题本 | 手动录入错题、查看详情、标记复习状态 |
| 周复盘 | 汇总本周产出与掌握度，无记录时惰性生成 |
| 数据总览 | 完成率、连续打卡、阶段进度等指标 |
| AI 助手 | SSE 流式对话；领域拦截（非学习类提问会被提示）；结合已上传文档给出摘录；推理强度可调 |
| 演示首屏 | `#/mainframe` 竞赛演示页：Agent 四步工作流动画、引用溯源卡片、站内信卡片 |

> 拍照搜题 / OCR 尚未实现，前端不做伪造展示。

## 技术栈

**前端** —— React 18 · TypeScript 5 · Vite 5 · Tailwind CSS 3 · framer-motion · zustand · lucide-react
**后端** —— FastAPI · SQLAlchemy 2 · Alembic · Pydantic Settings · SQLite（默认）/ MySQL
**AI 接入** —— 兼容 OpenAI 风格的 Chat Completions 与 `/models` 接口（DeepSeek 已实测，含 `reasoning_content` 兼容）
**测试** —— pytest + Hypothesis（属性测试）· Vitest

## 目录结构

```
study-pilot/
├── backend/
│   ├── app/
│   │   ├── core/        # 配置、数据库、AES-GCM 加解密
│   │   ├── models/      # SQLAlchemy 实体
│   │   ├── routers/     # REST + SSE 路由
│   │   └── services/    # 业务逻辑（规划、助手、指标、复盘…）
│   ├── alembic/         # 数据库迁移
│   ├── tests/           # pytest + Hypothesis 属性测试
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/  # 通用组件与 mainframe 演示模块
│   │   ├── pages/       # 总览 / Roadmap / 错题本 / 周复盘 / 个人中心
│   │   ├── lib/         # httpClient、各领域 API 封装
│   │   ├── store/       # zustand 状态
│   │   └── mocks/       # 演示数据兜底
│   └── .env.example
├── scripts/             # 素材处理与诊断脚本
└── DEPLOY.md            # 部署与演示清单
```

**请求链路**：前端 `lib/httpClient` → Vite 代理 `/api` → FastAPI 路由 → service 层 → SQLAlchemy；AI 相关接口经 `ai_proxy` 调用供应商，密钥在出口前解密。

## 快速开始

需要 Python 3.13 与 Node 18+。

### 1. 后端

```bash
cd backend
cp .env.example .env          # 填写 DATABASE_URL / AES_KEY
py -3.13 -m venv .venv
.venv/Scripts/activate        # Windows；Linux/macOS 用 source .venv/bin/activate
python -m pip install -r requirements.txt
python -m alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

访问 `http://127.0.0.1:8000/health` 应返回正常状态。

`AES_KEY` 必须是 base64 编码的 32 字节：

```bash
python -c "import base64,os;print(base64.b64encode(os.urandom(32)).decode())"
```

### 2. 前端

```bash
cd frontend
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。Vite 已将 `/api` 代理到 `127.0.0.1:8000`，会话 Cookie 同域可用。

### 3. 配置 AI

登录后进入个人中心，填写 API Key、Base URL 与模型（DeepSeek 填 `https://api.deepseek.com`，不要填 platform 控制台地址），保存时会真实校验一次。

## 测试

```bash
# 后端：内存 SQLite + 注入的 mock 生成器，不发起任何外部 AI 调用
cd backend
.venv/Scripts/python.exe -m pytest tests -q

# 前端
cd frontend
npm run test          # Vitest
npm run build         # tsc -b && vite build（类型检查只在 build 阶段生效）
```

后端属性测试（Hypothesis）每条属性至少迭代 100 次，用例注释中的 `Feature: study-pilot, Property N` 对应 `.kiro/specs/study-pilot/design.md` 的 Correctness Properties 表。

## 部署

见 [DEPLOY.md](DEPLOY.md)。要点：

- 推荐 **同域反向代理**（Nginx / Caddy：`/` → `frontend/dist`，`/api` → 后端），避免跨域丢 Cookie；
- 构建前端 `npm run build`，产物在 `frontend/dist`；
- 若前后端不同域，需额外配置 CORS 与 `SameSite=None; Secure`。

## 项目文档

- `.kiro/specs/study-pilot/` —— 需求、设计与任务分解（Kiro spec）
- [DEPLOY.md](DEPLOY.md) —— 本地联调、公网部署、竞赛演示主路径与手动验收清单

## 说明

本项目为课程设计 / 竞赛作品，仅供学习与研究使用。
