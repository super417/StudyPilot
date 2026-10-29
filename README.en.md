# StudyPilot

> An evidence-grounded capability map for AI-micro-major students.

Upload your lecture notes and your goal. The Agent reads the material, drafts an iterable study plan, and carries it down to daily tasks, check-ins, practice grading, mistakes and weekly reviews. Graded answers become evidence, and the statistics page turns that evidence into a learning diagnosis.

The first public push of this repository was a bulk import; the commit history after it is the real development record.

---

## What it solves

Built for students taking AI micro-majors or general AI courses — non-CS backgrounds, second to fourth year, trying to close an employability skill gap. The core claim: use AI to expose the distance between "finished the task" and "actually mastered it", not to do the studying for you. StudyPilot closes the plan → execute → review loop:

1. **Plan** — submit a goal and upload PDF / DOCX / TXT / MD material; the AI generates a phased plan grounded in those documents.
2. **Execute** — the plan breaks into daily tasks with check-ins for time and status; phases stay adjustable mid-course.
3. **Review** — practice grading and a mistake book capture weak spots, while weekly reviews, statistics and the learning diagnosis answer "how much did I actually move, and where am I still thin?"

## Features

| Module | Description |
|---|---|
| Auth & sessions | Register / login / logout, server-side cookie session, bcrypt-hashed passwords |
| AI access mode | Two mutually exclusive modes: **platform** (platform balance billed in CNY, or platform credits billed in points; models and payment channels are server-configured and off by default) or **your own API key** (profile page → "Advanced settings"; keys stored AES-256-GCM encrypted, model list pulled live from the provider's `/models`) |
| Platform account & top-up | Balance, reserved budget, available balance, ledger and top-up orders in the profile page; Alipay web payment / WeChat Native orders — **only a server-verified payment notification or an active query credits the balance** |
| Study material | Upload PDF / DOCX / TXT / MD; parsed server-side and used for planning and Q&A retrieval |
| Goal & planning | Conversational goal intake → SSE-streamed plan generation (clarify / notice / done events); full regeneration and per-phase editing; "撤销最近一次已确认调整" only shows when the plan really has a confirmed adjustment to undo, sits inside the chat preview's "计划操作" disclosure, and stays hidden if the availability read fails |
| Overview | Hero + scroll-narrated study loop + postcard-style overview, all reading real endpoints; the "进入我的总览" entry scrolls to the content block instead of switching tabs; unreadable modules are marked unavailable — **no fake plan card stitched from metrics** |
| Roadmap | Latest plan's phases and progress; toggle this week's task states; daily tasks can carry a link that opens a concrete course/video page |
| Daily tasks & check-ins | Today's task list, time logging, and three today-states (未反馈 / 已安排 / 已完成) |
| Practice & grading | Practice cards; grading mode selectable — **grade all / grade selected / auto-grade every n questions** — results (correct / partial / wrong) written as mastery evidence, with per-item retry on failure |
| Mistake book | Manual entry or photo OCR, detail view, review-status marking, spaced review at 1/2/4/7/15/30 days |
| Statistics | Metric cards, 30-day stacked answer chart, mastery distribution, top mistakes, 30-day practice calendar (click a day for that day's evidence and score), learning route, weekly report |
| Learning diagnosis | AI diagnosis report grounded in graded evidence, with latest / history / search views and a persisted rename |
| AI assistant | SSE streaming chat; domain guard for off-topic questions; excerpts from uploaded documents; adjustable reasoning effort; the main panel and the floating widget share one credential and one audio cache; the companion can be dragged, click to chat, double-click to expand, collapsed into a small avatar, and yields to page controls |
| Speech playback | Xiaoxiao online female voice; reply body streamed sentence by sentence, new replies pre-generated |
| Courses & notes | Course chapters (with user-supplied links, check-off when done) and free-form notes |
| Resumes | Built-in "实用简历管理" editor (a local mirror of Magic Resume) with AI polish through the profile credential; plus a personal-website resume template |
| Demo landing | `#/mainframe` presentation page: four-step Agent workflow animation, citation cards, notice card |

> The mistake book can read a question from a photo or uploaded image, using the model configured in Settings. Pick a vision-capable model (e.g. GPT-4o, Gemini).

## Overview screen

The `#/` overview is four layers:

1. **Hero** (`StudyPilotHero`) — headline and primary action with scroll parallax;
2. **Study-loop narrative** (`StudyPilotJourney`) — scroll-driven sections on Lenis smoothing plus GSAP ScrollTrigger;
3. **Postcard overview** (`StudyPilotPostcards`, `presentation='postcards'`, the default) — draggable watercolour postcard stack with a "today / latest weekly report" switch;
4. **Content block** (inside `#overview-content`) — goal, today's tasks, check-in, mastery and due-mistake review open as dialogs (`OverviewDetailsDialog`); "开始今天的学习" opens `DailyStartDialog` to pick tasks.

- **Real data only**: the overview reads `/api/metrics/overview`, `/api/plans/latest`, `/api/daily-tasks`, `/api/weekly-reviews/latest` and `/api/mistakes`. A module that fails to load shows `—` and is marked unavailable — no mock filler. When the metrics or plan endpoint fails the card is marked unavailable; **a "current plan" card is no longer stitched together from metrics**.
- **Learning cards inside the postcards**: up to 8 items for today's schedule and 6–7 for the latest review, each citing real tasks, graded evidence and the weekly report (sample sizes included); with no records they say so instead of leaving a gap or inventing content. Card height follows the real content instead of being forced equal.
- **Sticky headings on desktop**: a learning card's heading sticks below the visible floating nav (the offset is written to a CSS variable from the nav's real bottom, 0 when the nav is hidden); on mobile it returns to normal document flow.
- **"进入我的总览" entry**: both the top nav and the section CTAs scroll to `#overview-content` (`scrollToLearningOverview`) — no tab switch, no reload. Postcard-internal fallbacks point at `#learning-overview`; both anchors exist, the content block is the canonical target.
- **Back-to-top button**: `OverviewBackToTop` is mounted on every business page except the demo landing (overview / roadmap / mistakes / statistics / resume / profile / both resume sub-pages). It **hides on scroll down, shows on scroll up, and hides within 24px of the top**; clicking scrolls to top and respects `prefers-reduced-motion`. The profile page scrolls three independent columns, so the click also resets any container marked `data-back-to-top-scroll`.

### Postcard wordmark (2026-10-28)

The wordmark on the top-right letter card is now `STUDYPIL` instead of `MAILERB`, followed by the existing little figure (as the O) and a trailing T.

- Asset: `frontend/public/postcards/animation/mailerbot-heros.riv`. The Rive vector outlines were edited directly — no CSS mask, no DOM overlay text, no canvas substitute.
- Letters share one cap height and baseline; strokes are 25% heavier than the first pass, the main corners are rounded, and spacing follows the actual ink width. The figure (eyes included) and the trailing T are vertically centred.
- Original objects, hierarchy and references are preserved: no object added or removed, the file is still **1,186,524 bytes** with **15,022** objects. Desktop `built` and mobile `built_mobile` share the edited card; the original state machine and `scroll` binding are untouched.
- Verified that the full object stream still parses and that object/property offsets are unchanged; per-round byte diffs stay inside the authorised wordmark vertices/tangents and the two group Y values used for centring. In the final weighting pass the figure and trailing T were byte- and pixel-identical.
- A `@rive-app/canvas` probe loaded `built`, `built_mobile` and `mailerbot-postcard`, all firing `onLoad` with no `onLoadError` and no error/warn records; before/after screenshots were compared. The full scroll effect still needs checking against the reference recording on the real page.

Asset SHA-256: `b3adf7942745e221ad469c1c13ba22fed4165028496b19f3c19b24a6dcc6b484`.

To inspect locally: start the frontend, open the `#/` overview with a hard refresh, scroll to the top-right letter card and check the `STUDYPIL` + figure + T spelling, vertical alignment and motion with the card; repeat at mobile width. Debug probes and backups are not product deliverables.

## AI access modes and configuration sync

Two mutually exclusive modes, stored server-side in `billing_accounts.mode`: `byok` (the default — your own key, billed directly by the provider) and `platform` (billed by actual token usage, either from the platform balance in CNY or from platform credits in points). The profile page's first centre-column card is "平台余额与模型选择"; the former "API 调用与模型配置" card now lives in an **Advanced settings** disclosure at the bottom of that same card. The disclosure only affects display — the component stays mounted, so collapsing it never loses a saved key.

### Platform balance (off by default)

- **Catalog** `GET /api/billing/catalog`: exposes only model `id`, provider, display name, input/output price (CNY per million tokens), token limits, the per-call reservation cap and available payment channels — **never the key or the upstream URL**. An empty or invalid `BILLING_MODELS_JSON` yields an empty catalog with `platformAvailable=false`.
- **Account** `GET /api/billing/account`: current mode, selected model, balance, reserved budget, available balance, the latest 30 ledger entries and 20 top-up orders.
- **Switch** `PUT /api/billing/preferences` with `{mode: 'platform' | 'byok', modelId}`; switching back to your own key keeps the stored provider and key untouched.
- **Billing arithmetic**: integer micro-yuan (1 CNY = 1,000,000 micros, 1 fen = 10,000 micros); cost = input tokens × input price + output tokens × output price, summed and then rounded up once to a whole micro. Each call reserves the model's cap first, then settles on the verified usage and releases the remainder; an insufficient balance means no call at all, and network errors / timeouts / missing usage / empty output are not charged.
- **Covered capabilities**: assistant chat, plan generation and adjustment, learning diagnosis, practice generation and grading. Image OCR, material comparison and material tasks, and resume polish still require your own key and return `PLATFORM_CAPABILITY_UNAVAILABLE` in platform mode.
- **Top-up**: `POST /api/billing/orders` (1–1000 CNY, integer fen, `alipay` / `wechat`) and `POST /api/billing/orders/{id}/query` for an active query. Alipay returns a signed payment URL; WeChat returns a `code_url` that the frontend turns into a QR code (`qrcode`). **A browser redirect or a frontend "success" never credits the balance** — only a signature-verified notification or query result updates the order, the balance and the unique ledger reference in one transaction.
- **Deployment**: new migration `b1c2d3e4f5a6` (four billing tables), follow-up `b2f9e8d7c6a5` (call price snapshot) and `c3a1b2c3d4e5` (three credit tables); `alembic upgrade head` applies all three. Sample config in `backend/.env.billing.example`, **read server-side only — never expose these as `VITE_` variables**.
- **Not implemented**: refunds, automatic order closing, merchant reconciliation downloads, an admin console. The repository ships no real model prices and no payment credentials; `BILLING_PAYMENTS_ENABLED=false` by default, so no payment can be taken and no real payment or paid model call has occurred.

Full details (signature checks, precision, concurrency and failure boundaries) in [docs/platform-billing.md](docs/platform-billing.md).

### Platform credits (trial, off by default)

A second metering scheme that coexists with the platform balance, on a **separate ledger that never converts to or from the currency balance**: the balance uses the four `billing_*` tables, credits use `credit_lots` / `credit_calls` / `credit_ledger`. Switching still goes through `PUT /api/credits/preferences` with `mode` set to `platform` and `modelId` set to `credits:deepseek-flash`.

- **Endpoints**: `GET /api/credits/catalog` (available models, rates, plan display slots), `GET /api/credits/account` (available / reserved micro-points, grant lots, latest 30 ledger entries), `PUT /api/credits/preferences` (only `credits:deepseek-flash` is accepted; anything else returns 503).
- **Arithmetic**: 1 point = 1,000,000 micro-points; cost = input tokens × 40 + output tokens × 160, rounded up once to a whole micro-point. Each call reserves the cap (16,000 input / 4,096 output) first, settles on verified usage and releases the remainder; missing usage, timeouts and empty output are not charged, and an unsettled reservation is released after 10 minutes.
- **Free allowance**: 500 points per user per Beijing calendar month, expiring at month end and never carried over.
- **Model constraints**: pinned to `deepseek-flash`, non-streaming, thinking disabled, text only. Image OCR, material comparison / material tasks and resume polish still require your own key.
- **Enablement**: `CREDITS_DEEPSEEK_ENABLED=true` **and** a `deepseek` entry in `BILLING_PROVIDER_KEYS_JSON`; without both the catalog is empty and switching is rejected. The key is read server-side only.
- **Not implemented**: purchase, activation, auto-renewal and refunds are all closed — the free / 启航 / 补给 tiers in the catalog always report `purchaseAvailable=false`, with prices and point amounts shown for display only. Trial points are minted by an operator-run local grant function, **not a payment record**, and do not mean a paid subscription is live.

### Your own API key (advanced settings)

The **single source of truth is the profile page** card "API 调用与模型配置", backed by `/api/api-config` (`GET / POST / PUT / PATCH / DELETE`, plus `POST /api/api-config/models`).

Steps:

1. Enter Base URL (must start with `http://` or `https://`; for DeepSeek use `https://api.deepseek.com` — a pasted `platform.deepseek.com` console URL is normalised server-side);
2. Enter the API Key (plaintext lives in memory only, never in localStorage);
3. Fetch the model list — `POST /api/api-config/models` prefers the draft key + URL from the form and falls back to the stored config for whichever field is missing. Providers without a `/models` endpoint cannot be listed, so type the model name manually;
4. Pick a model and save. **Saving performs a real verification** (by default against the provider's `/models`, so an HTML console page cannot pass), and success sets `isVerified=true`.

Effect and sync behaviour:

- **When it takes effect**: immediately on a successful save, no restart. In "own API key" mode every AI call (assistant, planning, diagnosis, practice grading, OCR, resume polish) only uses a config with `isVerified=true`; unverified means unconfigured. In platform mode the assistant, planning, diagnosis and practice calls are metered against the platform balance and no longer read this config, while OCR and resume polish still require the key.
- **How it is stored**: the key is encrypted at rest (AES-256-GCM, derived from `AES_KEY`); read endpoints return only `apiKeyMasked` (last four characters). It survives device changes and cache clears.
- **Local storage holds preferences only**: model id and reasoning strength (`studypilot.modelPrefs.v1`) — never the key.
- **Where each chat surface gets its config**:
  - The main chat panel (`ChatPanel`) and the floating widget (`ChatWindow`) share `useAssistantChat` and both hit `/api/assistant/chat`; the backend resolves and decrypts the credential (`resolve_credential`) and uses it only in the outbound request header, so the frontend never sees plaintext;
  - The embedded resume editor (`/resume/practical` iframe) **never holds the key**: the profile page projects the verified config into its own `ai-config-storage` as a sentinel entry (`apiKey: '__STUDYPILOT_MANAGED__'`), and real calls go to `/api/ai-test`, `/api/grammar`, `/api/polish`, `/api/models`, where the backend swaps in the profile credential.
- **When the projection happens**: once when the profile card loads a config; again after every successful save/update; cleared when there is no config or it is unverified; and re-synced before the resume iframe mounts (a network or auth failure does not clear it, so a brief outage cannot wipe a working config).

## Statistics and learning diagnosis

**Metric row** (`/api/statistics/overview`): four icon cards — cumulative answers (graded items), study days (days with a check-in), uploaded material (knowledge-base documents), mistakes recorded.

**"近 30 日作答量"**: a stacked bar chart where each bar splits into correct / partial / wrong, sharing the colour scale with the mastery donut. A separate baseline bar below marks "new mistakes" — a different metric, not a fourth answer segment.

**Seven detail panels**: phase rings, 30-day answers, mastery distribution, top-5 mistakes, 30-day practice calendar, learning route, positive feedback and deferrals. Clicking a title opens that panel alone (the rest collapse into a thumbnail strip); "收起详情" returns to the two-column grid. The practice calendar stays expanded — it never enters the single-panel view and is not listed in the thumbnail strip.

**"近 30 日练习日历"** (`PracticeCalendar`, replacing the former star map):

- 30 cells laid out **Monday to Sunday** with padding before and after; dates follow Beijing time (`Asia/Shanghai`) regardless of the browser's zone; today carries `aria-current="date"`.
- Clicking a date opens that day's detail dialog fed by `GET /api/statistics/practice-days/{YYYY-MM-DD}`, reading `MasteryEvidence` for the Beijing-time day from 00:00 to 00:00 next day (exclusive).
- Scoring: **correct 100, partial 50, wrong 0**, mapped onto 100, with the UI stating it "only reflects recorded practice evidence and is not an accuracy rate or an overall ability score". A day with no evidence says so; rest days and offline study are never counted as unmastered.
- At most the latest 100 evidence rows are listed, with an explicit "N total, showing the latest 100; the summary above still covers the whole day"; fewer than 5 items triggers a "small sample" note. A read failure shows a retry button rather than a guessed value.
- The dialog's "打开习题本" only opens existing questions and **does not filter by the selected date** — the UI says so.

**Weekly report**: `/api/weekly-reviews/latest`, generated lazily when no record exists; the overview's "latest weekly report" tab and the statistics page read the same summary.

**Learning diagnosis** (`POST /api/statistics/diagnosis`):

- Evidence comes from `MasteryEvidence` (all-time result distribution plus at most 100 recent items). With no graded practice it refuses outright (`NO_PRACTICE_DATA`) instead of producing an empty report;
- Each report **is persisted as a conversation** (`context_type='free'`, `citations.kind='learning_diagnosis_v1'`), which is what makes it listable, renameable and durable rather than a one-off modal;
- **Three-way glass slider**: latest (`/diagnosis/latest`), history (`/diagnosis/history`, newest first), search;
- **Collapsible history**: clicking "历史报告" again collapses the list and leaves only the report body;
- **Search**: matches report title plus the Beijing-time date (`Asia/Shanghai`), filtered client-side over the already-fetched history;
- **Rename**: the pencil icon per row expands an input, 1–64 characters, written back to the conversation title (`PATCH /api/conversations/{id}`) and still there after a refresh.

## Speech playback and the assistant

Replies in the assistant widget (same conversation logic as the main chat panel) can be read aloud.

- **Voice**: Microsoft `zh-CN-XiaoxiaoNeural` — online. No fallback to the system synthesiser.
- **Service**: `speech/synthesize.py` reads one text segment from stdin and streams MP3 out via `edge-tts==7.3.1`. It runs in its own environment, `speech/.venv-edge`, invoked as a subprocess by `/api/speech/*` — **there is no separate service to start**; starting StudyPilot is enough.
- **Automatic pre-generation**: once a reply is **fully generated**, the frontend sends that reply's **body text** (Markdown stripped) sentence by sentence to `POST /api/speech/prewarm`. This **sends the body text to the online speech service actually in use (Microsoft edge-tts)** — it is not local synthesis. Pre-generation never auto-plays, and history is not batch-uploaded when the panel opens; only clicking the speaker generates audio for older replies.
- **Sources and citations are excluded**: playback and pre-generation take the message body only. `message.citations` (source list, document excerpts, citation cards) are never sent.
- **Streaming playback**: `POST /api/speech/playback` first issues a 120-second playback ticket bound to the current user, then `GET /api/speech/playback/{token}` streams MP3, playing from the first segment instead of waiting for the whole clip. The playback URL never contains the text.
- **Cache and sharing**: completed audio is cached in backend memory, isolated per user, expiring after 15 minutes with a 16 MiB / 128-segment cap, never written to disk. The main panel and the widget hit the same endpoints, so switching between them reuses the same cache.
- **Limits**: one segment ≤ 300 characters (the frontend chunks at 280, preferring sentence-ending punctuation), one clip ≤ 8 MiB, only 2 synthesis slots, and a 429 if a slot cannot be acquired within 0.5 s.
- **Stop**: cancels pending requests and drops the audio stream; the backend kills the running subprocess and releases the slot.
- **Speed**: a cache hit or a finished pre-generation starts quickly; an uncached first play still needs a network handshake and upstream synthesis, so **sub-second start is not guaranteed**.
- **Degradation**: without `speech/.venv-edge` the endpoints return 503 `SPEECH_UNAVAILABLE`. The fixed greeting clip `speech/output/greeting-xiaoxiao.mp3` is git-ignored and not in the repository, so a fresh clone has no spoken greeting — reply playback is unaffected.
- **Scope of what leaves the machine**: only the segment being read. No chat history, no uploaded material, no other messages.

### Assistant companion

The floating companion is an in-project component (`components/assistant/FloatingIcon.tsx`), not an external plugin:

- **Interaction**: drag the avatar to move it; **single click** opens/closes the chat (mouse clicks wait 450 ms so a double click can win, keyboard activation fires immediately, and finishing a drag never opens the chat by accident); **double click** expands the full-body character; the "收起" button at its top-right collapses it back into the small avatar and "展开" restores it. The anchor and the collapsed preference persist in `localStorage` (`studypilot.companion.anchor` / `studypilot.companion.collapsed`).
- **Default state**: with no saved preference the dock starts collapsed below 768 px and expanded on desktop.
- **Yielding**: when the dock overlaps visible controls inside `main` (buttons, inputs, headings), it lifts itself while staying inside the viewport; when a `dialog[open]` or `aria-modal` dialog is present the companion steps aside and comes back when the dialog closes. Expanding is an explicit choice — DOM mutations never collapse it silently.
- **Assets**: `frontend/public/assistant/companion-avatar.png` (the small avatar); the full-body character keeps the `chat-girl-*` assets (image / video frames). With the OS "reduce motion" setting the frame loop stops, only the still image remains, and entrance / talking states end immediately.

## Roadmap learning resources

Daily tasks can carry a `resourceUrl` pointing at a concrete course or video page.

- **Concrete pages only**: the host must be allow-listed (Bilibili, icourse163, XuetangX, Zhihuishu, Chaoxing, open.163, Coursera, Zhihu, kaoyan.com, chsi.com.cn, `edu.cn`, `ac.cn`, `mit.edu`, the national smart-education platform, rymooc — see `backend/app/services/resource_links.py`) **and** the path must land on actual content: Bilibili only `/video/BV…` or `/video/av…`; other platforms only `/video|/course|/learn|/lecture|/lesson|/training|/courseHome/…`. **Platform home pages, category pages and search pages are dropped**; the task description stays.
- **Read-only backfill for legacy tasks**: when daily tasks or phase details are read, a stored task without a link is matched against the local course-library metadata by course name and chapter outline; on a hit the response carries the link plus chapter / section titles (`direction_service.task_resource_fields`). **This only affects the response — no DB write, no snapshot change.** No match means no link; nothing is invented.
- **The frontend filters again**: `TaskResourceLink` runs `isConcreteResourceUrl` so legacy home-page links are not rendered.

Honest boundaries: not every task has a video; backfill is metadata matching against the local course library, not a per-item online verification; and a reachable link does not prove the content matches the task exactly.

## Tech stack

**Frontend** — React 18 · TypeScript 5 · Vite 5 · Tailwind CSS 3 · framer-motion · GSAP + Lenis · Rive · three (lazy) · zustand · lucide-react · jsPDF · qrcode (WeChat top-up QR)
**Backend** — FastAPI · SQLAlchemy 2 · Alembic · Pydantic Settings · SQLite (default) / MySQL
**AI integration** — OpenAI-style Chat Completions and `/models` (verified against DeepSeek, including `reasoning_content`), plus a server-side metered gateway that charges the platform balance from real usage
**Speech** — edge-tts 7.3.1 (Xiaoxiao online voice) in a separate venv, not part of the backend requirements
**Testing** — pytest + Hypothesis (property-based) · Vitest + fast-check

## Layout

```
study-pilot/
├── backend/
│   ├── app/
│   │   ├── core/        # settings, database, AES-GCM crypto
│   │   ├── models/      # SQLAlchemy entities
│   │   ├── routers/     # REST + SSE endpoints (incl. speech / resume_ai / statistics / billing)
│   │   └── services/    # domain logic (planning, assistant, diagnosis, metrics, review, resource links, billing gateway…)
│   ├── alembic/         # migrations
│   ├── tests/           # pytest + Hypothesis
│   ├── .env.example
│   └── .env.billing.example  # platform balance / payment config sample (empty = off)
├── frontend/
│   ├── src/
│   │   ├── components/  # shared components, overview trio, statistics/diagnosis, chat + widget
│   │   ├── pages/       # overview / roadmap / mistakes / statistics / resume / profile
│   │   ├── lib/         # httpClient, per-domain API clients, speech and config bridges
│   │   ├── store/       # zustand stores
│   │   └── mocks/       # types and demo-data fallbacks
│   ├── public/resume-site/  # embedded resume editor (local mirror)
│   └── .env.example
├── speech/              # Xiaoxiao voice client (synthesize.py / setup.ps1 / own venv)
├── data/                # direction, job and course-library metadata (JSON)
├── scripts/             # asset processing, port cleanup, diagnostics
├── start-all.bat        # one-click launcher
└── DEPLOY.md            # deployment and demo checklist
```

**Request path**: frontend `lib/httpClient` → Vite proxy `/api` → FastAPI router → service layer → SQLAlchemy. AI calls go through `ai_proxy`, with the stored key decrypted only at the outbound boundary.

## Environment and reproduction

### Requirements

- Python 3.13 (used for both the backend venv and the speech venv)
- Node 18+ (the development machine runs Node 22)
- Windows can use `start-all.bat`; Linux / macOS follow the commands below

### Backend environment (`backend/.env`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | none | SQLAlchemy URL. Development: `sqlite:///./studypilot.db` |
| `DB_PASSWORD` | yes (may be empty) | none | Real value only for MySQL; keep the variable present but empty on SQLite |
| `AES_KEY` | yes | none | base64-encoded 32 bytes, encrypts stored user API keys. Empty means crypto errors at use time |
| `SESSION_TIMEOUT_MINUTES` | no | `30` | Session lifetime in minutes |
| `BILLING_*` | no | empty / `false` | Platform balance and top-up config, sample in `backend/.env.billing.example`. Left empty the catalog has no models, payment channels are unavailable and nothing can be charged |
| `CREDITS_DEEPSEEK_ENABLED` | no | `false` | Platform credits switch; also needs a `deepseek` entry in `BILLING_PROVIDER_KEYS_JSON` to actually work. When off the credit catalog is empty and switching is rejected |

`DATABASE_URL`, `DB_PASSWORD` and `AES_KEY` have no defaults in `Settings`, so a missing one fails startup — intentionally: better a loud startup error than a server running on an empty key.

`BILLING_*` is a separate group (`BILLING_MODELS_JSON`, `BILLING_PROVIDER_KEYS_JSON`, `BILLING_PAYMENTS_ENABLED` and the Alipay / WeChat merchant fields) with safe defaults — leaving it out does not affect the basic features. **These fields are read server-side only; never turn them into `VITE_` variables** or the secrets end up in the frontend bundle.

### Frontend environment (`frontend/.env`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `VITE_API_BASE_URL` | no | empty | Empty means the Vite `/api` proxy to `127.0.0.1:8000`. Keep empty for same-origin production reverse proxies; set it only when frontend and API live on different origins (no trailing slash) |

### Ports and proxy

| Item | Value |
|---|---|
| Backend | `127.0.0.1:8000` (`/health` for liveness) |
| Frontend | `127.0.0.1:5173` |
| Proxy | Vite `server.proxy['/api'] → http://127.0.0.1:8000`, `changeOrigin: true` |
| Session | Same-origin cookie; cross-origin needs CORS plus `SameSite` work |

### Start

```bash
# Backend
cd backend
cp .env.example .env          # fill DATABASE_URL / DB_PASSWORD / AES_KEY
py -3.13 -m venv .venv
.venv/Scripts/activate        # use source .venv/bin/activate on Linux/macOS
python -m pip install -r requirements.txt
python -m alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Frontend (second terminal)
cd frontend
npm install
npm run dev
```

Generate `AES_KEY`:

```bash
python -c "import base64,os;print(base64.b64encode(os.urandom(32)).decode())"
```

### Speech environment (only for playback)

```powershell
# Run from the repository root; creates speech/.venv-edge and installs edge-tts
powershell -ExecutionPolicy Bypass -File speech/setup.ps1
```

Everything except playback works without it; the speech endpoints just return 503.

`setup.ps1` is Windows-only (it builds the venv with PowerShell). On Linux / macOS create the same path by hand: `python -m venv speech/.venv-edge && speech/.venv-edge/bin/pip install -r speech/requirements.txt` (the backend looks for `Scripts/python.exe` on Windows and `bin/python` elsewhere).

### One-click launcher

`start-all.bat` in the repository root checks `.venv` and `.env`, installs `node_modules` if missing, clears leftover processes on 8000 / 5173, opens two windows (backend runs `alembic upgrade head` then `--reload`; frontend runs `--strictPort`), and opens the browser once the frontend answers 200.

## 10-minute reproduction guide

Goal: from a clean machine to the minimal loop of upload material → generate a plan → answer practice → read a diagnosis.

> **Timing was not re-measured this round.** The steps below were checked against the current code, but no timing conclusion is attached; actual duration depends on the network (`pip` / `npm` downloads, whether the speech environment is installed) and on already having an AI key.

1. Install Python 3.13 and Node 18+;
2. `git clone` and enter the repository root;
3. `cd backend && cp .env.example .env`, generate and fill `AES_KEY` (keep the default SQLite `DATABASE_URL`, leave `DB_PASSWORD` empty);
4. `py -3.13 -m venv .venv` → `.venv/Scripts/activate` → `pip install -r requirements.txt` → `python -m alembic upgrade head`;
5. `uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`, confirm `/health` returns 200;
6. In a second terminal `cd frontend && npm install && npm run dev`, open `http://127.0.0.1:5173`;
7. Register → fill API Key / Base URL / model in the profile page and save (save verifies) → upload a PDF/DOCX/TXT/MD → submit a goal in the assistant to generate a plan → check in from the overview → generate a learning diagnosis on the statistics page.

Works without a key: registration and login, material upload and parsing, tasks and check-ins, mistake book, check-in-based statistics. Needs a key **or a platform balance / credits**: plan generation, assistant chat, grading, diagnosis; image OCR and resume polish accept only your own key.

Speech playback is optional and separate — run `speech/setup.ps1` after step 8.

## Tests

```bash
# Backend: in-memory SQLite with injected mock generators — no external AI calls
cd backend
.venv/Scripts/python.exe -m pytest -q

# Frontend
cd frontend
npm run test          # Vitest
npm run build         # tsc -b && vite build (type checking only runs here)
```

**The backend baseline is not green.** Measured on 2026-10-29 at `d49fab3` plus the uncommitted billing batch: **2 failed, everything else passing**. Those 2 are the two parametrised cases in `tests/test_video_link.py::test_bilibili_metadata_can_be_read_when_local_dns_is_unavailable`, which need real Bilibili DNS — not regressions. The passed count grows with each batch; run it, don't copy old numbers.

`tsc -b` is still blocked by 19 type errors in **pre-existing test files** (`AssistantNamePrompt`, `planner/*`, `adjustmentPreviewActions`), unrelated to product source; `npm run build` therefore fails while the Vite product bundle alone still builds. Do not count these as regressions and do not "fix" them by weakening tests.

Always use `backend/.venv`'s Python: the system Python has an incompatible `bcrypt` / `passlib` pair and produces hundreds of phantom failures.

Backend property tests (Hypothesis) run at least 100 iterations per property; the `Feature: study-pilot, Property N` markers in test docstrings map to the Correctness Properties table in `.kiro/specs/study-pilot/design.md`.

## Deployment

See [DEPLOY.md](DEPLOY.md). Key points:

- A **same-origin reverse proxy** is recommended (Nginx / Caddy: `/` → `frontend/dist`, `/api` → backend) to avoid losing cookies across origins.
- Build with `npm run build`; output lands in `frontend/dist`.
- Cross-origin setups additionally need CORS and `SameSite=None; Secure`.
- `frontend/public/resume-site/` serves assets from the site root, so static hosting must route `/zh`, `/en`, `/app/*`, `/assets/*`, `/fonts/*`, `/landing/*` to `/resume-site/` (the dev/preview plugin in `vite.config.ts` handles it locally; `DEPLOY.md` has an nginx snippet).
- Speech needs `speech/.venv-edge` plus outbound access to the upstream voice service — run `speech/setup.ps1` once on the deploy host.

## Documentation

- `.kiro/specs/study-pilot/` — requirements, design and task breakdown (Kiro spec)
- [docs/platform-billing.md](docs/platform-billing.md) — platform balance: catalog config, billing precision, reservation and settlement, payment signature checks and failure boundaries
- [DEPLOY.md](DEPLOY.md) — local setup, public deployment, demo path and manual acceptance checklist

## Note

Course project / competition entry. For study and research use only.
