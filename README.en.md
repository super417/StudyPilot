# StudyPilot

> An evidence-grounded AI study companion for grad-school exam prep.

Upload your lecture notes and your goal. The Agent reads the material, drafts an iterable study plan, and carries it down to daily tasks, check-ins, mistakes and weekly reviews.

---

## What it solves

Exam prep usually breaks in three places: the plan never gets settled, it never survives contact with reality, and progress is invisible. StudyPilot closes that loop:

1. **Plan** — submit a goal and upload PDF / DOCX / TXT / MD material; the AI generates a phased plan grounded in those documents.
2. **Execute** — the plan is broken into daily tasks with check-ins for time and status; phases stay editable.
3. **Review** — a mistake book captures weak spots, while weekly reviews and the metrics overview answer "how much did I actually move this week?"

## Features

| Module | Description |
|---|---|
| Auth & sessions | Register / login / logout, server-side cookie session, bcrypt-hashed passwords |
| AI configuration | Enter API Key / Base URL / model in the profile page; keys stored AES-256-GCM encrypted, model list pulled live from the provider's `/models` |
| Study material | Upload PDF / DOCX / TXT / MD; parsed server-side and used for planning and Q&A retrieval |
| Goal & planning | Conversational goal intake → SSE-streamed plan generation (clarify / notice / done events); full regeneration and per-phase editing |
| Roadmap | Latest plan's phases and progress; toggle this week's task states |
| Daily tasks & check-ins | Today's task list, time logging, and three today-states (未反馈 / 已安排 / 已完成) |
| Mistake book | Manual entry, detail view, review-status marking |
| Weekly review | Weekly output and mastery summary, lazily generated when no record exists |
| Metrics overview | Completion rate, streak, phase progress |
| AI assistant | SSE streaming chat; domain guard for off-topic questions; excerpts from uploaded documents; adjustable reasoning effort |
| Demo landing | `#/mainframe` presentation page: four-step Agent workflow animation, citation cards, notice card |

> The mistake book can read a question from a photo or uploaded image, using the model configured in Settings. Pick a vision-capable model (e.g. GPT-4o, Gemini).

## Tech stack

**Frontend** — React 18 · TypeScript 5 · Vite 5 · Tailwind CSS 3 · framer-motion · zustand · lucide-react
**Backend** — FastAPI · SQLAlchemy 2 · Alembic · Pydantic Settings · SQLite (default) / MySQL
**AI integration** — OpenAI-style Chat Completions and `/models` (verified against DeepSeek, including `reasoning_content`)
**Testing** — pytest + Hypothesis (property-based) · Vitest

## Layout

```
study-pilot/
├── backend/
│   ├── app/
│   │   ├── core/        # settings, database, AES-GCM crypto
│   │   ├── models/      # SQLAlchemy entities
│   │   ├── routers/     # REST + SSE endpoints
│   │   └── services/    # domain logic (planning, assistant, metrics, review…)
│   ├── alembic/         # migrations
│   ├── tests/           # pytest + Hypothesis
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/  # shared components + mainframe demo modules
│   │   ├── pages/       # overview / roadmap / mistakes / weekly review / profile
│   │   ├── lib/         # httpClient and per-domain API clients
│   │   ├── store/       # zustand stores
│   │   └── mocks/       # demo-data fallbacks
│   └── .env.example
├── scripts/             # asset processing and diagnostics
└── DEPLOY.md            # deployment and demo checklist
```

**Request path**: frontend `lib/httpClient` → Vite proxy `/api` → FastAPI router → service layer → SQLAlchemy. AI calls go through `ai_proxy`, with the stored key decrypted only at the outbound boundary.

## Getting started

Requires Python 3.13 and Node 18+.

### 1. Backend

```bash
cd backend
cp .env.example .env          # fill in DATABASE_URL / AES_KEY
py -3.13 -m venv .venv
.venv/Scripts/activate        # Windows; use source .venv/bin/activate on Linux/macOS
python -m pip install -r requirements.txt
python -m alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

`GET http://127.0.0.1:8000/health` should respond once the service is up.

`AES_KEY` must be 32 bytes, base64-encoded:

```bash
python -c "import base64,os;print(base64.b64encode(os.urandom(32)).decode())"
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to `127.0.0.1:8000`, so session cookies work same-origin.

### 3. Configure the AI provider

In the profile page, enter your API Key, Base URL and model (for DeepSeek use `https://api.deepseek.com`, not the platform console host). Saving triggers a real validation call.

## Tests

```bash
# Backend: in-memory SQLite with injected mock generators — no external AI calls
cd backend
.venv/Scripts/python.exe -m pytest tests -q

# Frontend
cd frontend
npm run test          # Vitest
npm run build         # tsc -b && vite build (type checking only runs here)
```

Backend property tests (Hypothesis) run at least 100 iterations per property; the `Feature: study-pilot, Property N` markers in test docstrings map to the Correctness Properties table in `.kiro/specs/study-pilot/design.md`.

## Deployment

See [DEPLOY.md](DEPLOY.md). Key points:

- A **same-origin reverse proxy** is recommended (Nginx / Caddy: `/` → `frontend/dist`, `/api` → backend) to avoid losing cookies across origins.
- Build with `npm run build`; output lands in `frontend/dist`.
- Cross-origin setups additionally need CORS and `SameSite=None; Secure`.

## Documentation

- `.kiro/specs/study-pilot/` — requirements, design and task breakdown (Kiro spec)
- [DEPLOY.md](DEPLOY.md) — local setup, public deployment, demo path and manual acceptance checklist

## Note

Course project / competition entry. For study and research use only.
