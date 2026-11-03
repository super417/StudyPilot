#!/usr/bin/env python3
"""StudyPilot 每日用户流程模拟：真实 API、真实数据、JSONL 报告。"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
import time
import uuid

import httpx

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent if (SCRIPT_DIR.parent / '.ai-handoff' / 'demo-materials').is_dir() else SCRIPT_DIR
ENV_FILE = ROOT / ".ai-handoff" / "user-flow.env"
MATERIAL_DIR = ROOT / ".ai-handoff" / "demo-materials"
MATERIAL_FILENAMES = (
    "01-python-variables-for-ledger.md",
    "02-control-flow-and-budget.md",
    "03-functions-for-ledger.md",
    "04-data-structures-and-statistics.md",
    "05-classes-and-data-quality.md",
    "06-persistence-and-testing.md",
)
REPORT_PATH = ROOT / ".ai-handoff" / "user-flow-reports.jsonl"

# 仅 GET 可退避重试；写请求可能已落库，响应丢失时也不得重发。
TRANSIENT_STATUS = {429, 500, 502, 503, 504}
RETRY_ATTEMPTS = 3
RETRY_DELAYS = (5, 20)
# 报告类步骤：失败不影响主学习闭环，仅把整次运行标记为 partial。
OPTIONAL_STEPS = {"generate_diagnosis"}


class FlowError(RuntimeError):
    pass


def iso_now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def load_env_file() -> None:
    """读取私有配置；已存在的系统环境变量优先。"""
    if not ENV_FILE.is_file():
        return
    for raw in ENV_FILE.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().removeprefix("export ").strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


def response_error(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return response.text[:300] or "无响应正文"
    if isinstance(body, dict):
        code = body.get("code")
        message = body.get("message") or body.get("detail") or body.get("status")
        return " ".join(str(item) for item in (code, message) if item)[:500]
    return str(body)[:300]


def parse_sse(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for block in text.replace("\r\n", "\n").split("\n\n"):
        event = "message"
        data_lines: list[str] = []
        for line in block.splitlines():
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
        if not data_lines:
            continue
        try:
            data = json.loads("\n".join(data_lines))
        except json.JSONDecodeError as error:
            raise FlowError(f"规划接口返回了无效 SSE 数据：{error}") from error
        if not isinstance(data, dict):
            raise FlowError("规划接口返回的 SSE 数据不是对象")
        events.append((event, data))
    return events


def material_for_day(day: date) -> Path:
    filename = MATERIAL_FILENAMES[day.toordinal() % len(MATERIAL_FILENAMES)]
    return MATERIAL_DIR / filename


def material_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def previously_uploaded_documents(material_hash: str, base_url: str, username: str) -> list[str]:
    """返回同一服务、同一账户曾成功上传该内容的资料 ID。"""
    if not REPORT_PATH.is_file():
        return []
    ids: list[str] = []
    for raw in REPORT_PATH.read_text(encoding="utf-8-sig").splitlines():
        if not raw.strip():
            continue
        try:
            item = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if (item.get("materialSha256") != material_hash
                or str(item.get("baseUrl", "")).rstrip("/") != base_url.rstrip("/")
                or item.get("username") != username):
            continue
        for step in item.get("steps") or []:
            if step.get("name") == "upload_material" and step.get("status") in ("success", "skipped"):
                doc_id = (step.get("details") or {}).get("docId")
                if doc_id:
                    ids.append(str(doc_id))
    return list(reversed(ids))


def practice_answer_plan(day: date, question_count: int) -> list[bool]:
    """首次作答非全对率不超过 40%，相邻日期至少相差 1/N（N<=10）。"""
    if question_count < 3:
        raise FlowError("今日练习少于 3 题，无法满足错误率上限并形成跨日差异")
    minimum_correct = (3 * question_count + 4) // 5
    correct_count = minimum_correct + day.toordinal() % (question_count - minimum_correct + 1)
    correct_indexes = {(index * question_count) // correct_count for index in range(correct_count)}
    return [index in correct_indexes for index in range(question_count)]


class UserFlow:
    def __init__(self, report: dict) -> None:
        self.report = report
        self.report.setdefault("retries", [])
        self.client: httpx.AsyncClient | None = None
        self.today = date.today()
        self.material_path = material_for_day(self.today)
        self.report["material"] = str(self.material_path.relative_to(ROOT))
        self.report["materialTopic"] = self.material_path.stem
        self.report["materialSha256"] = material_sha256(self.material_path)
        self.doc_id = ""
        self.plan_id = ""
        self.phase_ids: set[str] = set()
        self.phase_id = ""
        self.today_minutes = 30
        self.today_tasks: list[dict] = []
        self.selected_task_ids: list[str] = []
        self.questions: list[dict] = []
        self.practice_correct_flags: list[bool] = []
        self.question_id = ""
        self.answer = ""
        self.adjustment_id = ""
        self.selection_version = 1
        self.reinforcement_task_ids: set[str] = set()

    async def step(self, name: str, action) -> None:
        started = time.monotonic()
        entry = {"name": name, "status": "running", "startedAt": iso_now()}
        optional = name in OPTIONAL_STEPS
        if optional:
            entry["optional"] = True
        self.report["steps"].append(entry)
        try:
            details = await action()
        except Exception as error:
            entry.update(
                status="failed",
                finishedAt=iso_now(),
                durationMs=round((time.monotonic() - started) * 1000),
                error=f"{type(error).__name__}: {error}",
            )
            if optional:
                print(f"[降级] {name} 失败但属非关键步骤，继续后续流程：{error}", flush=True)
                return
            print(f"[失败] {name}: {error}", flush=True)
            raise
        skipped = name == "upload_material" and details.get("skipped") is True
        entry.update(
            status="skipped" if skipped else "success",
            finishedAt=iso_now(),
            durationMs=round((time.monotonic() - started) * 1000),
            details=details,
        )
        print(f"[{'跳过' if skipped else '完成'}] {name} ({entry['durationMs']} ms)", flush=True)

    async def _retry_wait(self, label: str, reason: str, attempt: int) -> None:
        delay = RETRY_DELAYS[min(attempt - 1, len(RETRY_DELAYS) - 1)]
        self.report["retries"].append(
            {"target": label, "attempt": attempt, "reason": reason[:300], "delaySeconds": delay}
        )
        print(f"[重试] {label} 第 {attempt} 次尝试失败（{reason}），{delay}s 后重试", flush=True)
        await asyncio.sleep(delay)

    async def request(self, method: str, path: str, expected=(200,), **kwargs) -> dict:
        assert self.client is not None
        label = f"{method} {path}"
        response: httpx.Response | None = None
        last_error = ""
        attempts = RETRY_ATTEMPTS if method.upper() == "GET" else 1
        for attempt in range(1, attempts + 1):
            try:
                response = await self.client.request(method, path, **kwargs)
            except httpx.HTTPError as error:
                response = None
                last_error = f"网络错误：{error}"
            else:
                if response.status_code not in TRANSIENT_STATUS:
                    break
                last_error = f"HTTP {response.status_code}：{response_error(response)}"
            if attempt < attempts:
                await self._retry_wait(label, last_error, attempt)
        if response is None:
            raise FlowError(f"{label} {last_error}")
        if response.status_code not in expected:
            raise FlowError(
                f"{label} 返回 HTTP {response.status_code}：{response_error(response)}"
            )
        try:
            body = response.json()
        except ValueError as error:
            raise FlowError(f"{label} 未返回 JSON") from error
        if isinstance(body, dict) and body.get("status") == "error":
            raise FlowError(f"{label} 业务失败：{response_error(response)}")
        if not isinstance(body, dict):
            raise FlowError(f"{label} JSON 顶层不是对象")
        return body

    async def _post_with_retry(self, path: str, payload: dict) -> httpx.Response:
        """保留调用入口；SSE 写入也只发送一次，避免重复生成规划。"""
        assert self.client is not None
        try:
            return await self.client.post(path, json=payload)
        except httpx.HTTPError as error:
            raise FlowError(f"POST {path} 网络错误（未重试）：{error}") from error

    async def health(self) -> dict:
        body = await self.request("GET", "/health")
        if body.get("status") != "ok":
            raise FlowError("后端健康检查未通过")
        return {"status": "ok"}

    async def login(self) -> dict:
        body = await self.request(
            "POST",
            "/api/auth/login",
            json={
                "username": os.environ.get("STUDYPILOT_USERNAME", "super"),
                "password": os.environ["STUDYPILOT_PASSWORD"],
            },
        )
        if not body.get("userId"):
            raise FlowError("登录响应缺少 userId")
        return {"userId": body["userId"], "dataLoad": body.get("dataLoad", {}).get("status")}

    async def upload_material(self) -> dict:
        previous = previously_uploaded_documents(self.report['materialSha256'], self.report['baseUrl'], self.report['username'])
        if previous:
            body = await self.request("GET", "/api/documents")
            ready = {str(item.get("docId")): item for item in body.get("documents", []) if item.get("ready")}
            for doc_id in previous:
                if doc_id in ready:
                    self.doc_id = doc_id
                    return {"skipped": True, "docId": doc_id, "filename": ready[doc_id].get("filename"), "message": "资料已存在，跳过上传"}
            raise FlowError("历史上传的资料当前不可用或未就绪，无法安全复用；请检查资料后重试")
        data = self.material_path.read_bytes()
        body = await self.request(
            "POST",
            "/api/documents",
            expected=(201,),
            files={"file": (self.material_path.name, data, "text/markdown; charset=utf-8")},
        )
        self.doc_id = str(body.get("docId") or "")
        if not self.doc_id or int(body.get("chunks") or 0) < 1:
            raise FlowError("上传响应缺少有效 docId 或 chunks")
        return {
            "docId": self.doc_id,
            "chunks": body["chunks"],
            "bytes": len(data),
            "filename": self.material_path.name,
        }

    async def verify_document(self) -> dict:
        body = await self.request("GET", "/api/documents")
        matched = next(
            (item for item in body.get("documents", []) if item.get("docId") == self.doc_id),
            None,
        )
        if not matched or not matched.get("ready"):
            raise FlowError("上传后的讲义未出现在就绪资料清单中")
        return {"docId": self.doc_id, "ready": True, "filename": matched.get("filename")}

    async def generate_plan(self) -> dict:
        assert self.client is not None
        payload = {
            "goalName": f"Python 基础学习与记账本实战（自动巡检 {self.report['runId'][:8]}）",
            "goalDate": (self.today + timedelta(days=45)).isoformat(),
            "currentLevel": (
                "上海财经大学统计学专业，Python 零基础；以记账本项目牵引学习，"
                "重视输入校验、统计口径、金额精度和可复现的自动化测试"
            ),
            "dailyMinutes": 30,
            "completionCriterion": (
                "掌握变量、数据类型、控制流、函数、类、异常、文件操作和模块；"
                "独立完成带收支记录、JSON 持久化、预算提醒、重复与损坏数据处理、"
                "Decimal 金额精度及核心函数自动化测试的命令行记账本"
            ),
            "documentIds": [self.doc_id],
        }
        try:
            response = await self._post_with_retry("/api/plans/generate", payload)
        except httpx.HTTPError as error:
            raise FlowError(f"规划生成网络错误：{error}") from error
        if response.status_code != 200:
            raise FlowError(f"规划生成返回 HTTP {response.status_code}：{response_error(response)}")
        events = parse_sse(response.text)
        errors = [data for event, data in events if event == "error"]
        if errors:
            raise FlowError(f"规划生成失败：{errors[-1].get('code')} {errors[-1].get('message')}")
        done = [data for event, data in events if event == "done"]
        if not done:
            names = [event for event, _ in events]
            raise FlowError(f"规划生成未收到 done 事件，实际事件：{names}")
        self.plan_id = str(done[-1].get("planId") or "")
        if not self.plan_id:
            raise FlowError("规划 done 事件缺少 planId")
        return {
            "planId": self.plan_id,
            "phases": done[-1].get("phases"),
            "usedDocs": done[-1].get("usedDocs"),
            "events": [event for event, _ in events],
        }

    async def start_plan_today(self) -> dict:
        body = await self.request(
            "POST", "/api/plans/start", json={"message": "今天", "planId": self.plan_id}
        )
        if body.get("startDate") != self.today.isoformat():
            raise FlowError("规划 startDate 不是今天")
        return {"planId": self.plan_id, "startDate": body["startDate"]}

    async def verify_plan(self) -> dict:
        body = await self.request("GET", "/api/plans/latest")
        plan = body.get("plan") or {}
        if plan.get("id") != self.plan_id or body.get("empty"):
            raise FlowError("最新规划不是本次生成的规划")
        phases = body.get("phases") or []
        self.phase_ids = {str(item.get("id")) for item in phases if item.get("id")}
        if not self.phase_ids:
            raise FlowError("本次规划没有阶段")
        self.phase_id = str(phases[0]["id"])
        return {"planId": self.plan_id, "phaseCount": len(self.phase_ids), "firstPhaseId": self.phase_id}

    async def select_today_tasks(self) -> dict:
        pending = []
        for phase_id in self.phase_ids:
            body = await self.request("GET", f"/api/phases/{phase_id}/tasks")
            pending.extend(task for task in body.get("tasks", []) if task.get("status") == "pending")
        choices = list({task["id"]: task for task in pending}.values())
        choices.sort(key=lambda task: (task.get("taskDate") != self.today.isoformat(), task.get("taskDate"), task["id"]))
        selected = []
        used_minutes = 0
        for task in choices:
            minutes = int(task.get("estimatedMinutes") or 30)
            if selected and used_minutes + minutes > self.today_minutes:
                continue
            selected.append(task)
            used_minutes += minutes
        if not selected:
            raise FlowError("本次规划没有可选择的待办任务")
        body = await self.request(
            "PUT",
            "/api/daily-selection",
            json={
                "date": self.today.isoformat(),
                "taskIds": [task["id"] for task in selected],
                "minutes": self.today_minutes,
            },
        )
        self.today_tasks = body.get("tasks") or []
        if not self.today_tasks:
            raise FlowError("保存今日任务后选择列表为空")
        self.selected_task_ids = [str(task["id"]) for task in selected]
        if not set(self.selected_task_ids).issubset({str(task.get("id")) for task in self.today_tasks}):
            raise FlowError("保存后的今日任务不包含本次选择，无法继续")
        return {
            "selectedTaskIds": [task["id"] for task in selected],
            "selectedCount": len(selected),
            "displayedCount": len(self.today_tasks),
            "minutes": self.today_minutes,
        }

    async def complete_today_learning(self) -> dict:
        learned = []
        for task in self.today_tasks:
            if task.get("status") != "pending" or task.get("learned"):
                continue
            await self.request(
                "POST",
                f"/api/daily-selection/{task['id']}/learned",
                params={"date": self.today.isoformat()},
            )
            task["learned"] = True
            learned.append(task["id"])
        pending = [task["id"] for task in self.today_tasks if task.get("status") == "pending"]
        if any(not task.get("learned") for task in self.today_tasks if task.get("status") == "pending"):
            raise FlowError("仍有今日任务未完成知识点学习")
        return {"learnedTaskIds": learned, "learnedCount": len(learned), "pendingTaskIds": pending}

    async def check_in(self) -> dict:
        task_id = self.selected_task_ids[0] if self.selected_task_ids else ""
        if not task_id:
            raise FlowError("打卡需要关联今日任务，但今日任务为空")
        body = await self.request(
            "POST",
            "/api/check-ins",
            expected=(201,),
            json={
                "taskId": task_id,
                "checkDate": self.today.isoformat(),
                "durationMinutes": 30,
                "difficulty": 3,
                "energy": 4,
                "note": f"自动用户流程巡检 {self.report['runId']}",
            },
        )
        if not body.get("checkInId"):
            raise FlowError("打卡响应缺少 checkInId")
        return {"checkInId": body["checkInId"], "taskId": task_id, "durationMinutes": 30}

    async def generate_practice(self) -> dict:
        body = await self.request(
            "POST", "/api/practice/generate-daily", json={"date": self.today.isoformat()}
        )
        questions = body.get("questions") or []
        if not questions:
            raise FlowError("练习生成成功但没有返回题目")
        for question in questions:
            if not question.get("id") or not str(question.get("answer") or "").strip():
                raise FlowError("题目缺少 id 或参考答案，无法执行混合判分巡检")
        self.questions = questions
        self.practice_correct_flags = practice_answer_plan(self.today, len(questions))
        self.question_id = str(questions[0]["id"])
        planned_correct = sum(self.practice_correct_flags)
        return {
            "questionCount": len(questions),
            "plannedCorrectAnswers": planned_correct,
            "plannedAccuracy": round(planned_correct / len(questions), 4),
            "plannedWrongRate": round((len(questions) - planned_correct) / len(questions), 4),
        }

    async def _grade(self, question_id: str, answer: str, answer_source: str) -> dict:
        body = await self.request(
            "POST", f"/api/practice/{question_id}/grade", json={"answerText": answer}
        )
        result = body.get("result")
        evidence_id = (body.get("evidence") or {}).get("id")
        if result not in {"correct", "partial", "wrong"} or not evidence_id:
            raise FlowError("判分响应缺少有效结果或证据 id")
        return {
            "questionId": question_id,
            "result": result,
            "evidenceId": evidence_id,
            "answerSource": answer_source,
        }

    async def grade_practice(self) -> dict:
        results = []
        blank = 0
        for question, use_reference in zip(self.questions, self.practice_correct_flags):
            answer = (
                str(question["answer"]).strip()
                if use_reference
                else "这道题我暂时不会，无法给出正确解答。"
            )
            source = "reference" if use_reference else "synthetic_no_answer_for_wrong_case"
            blank += not bool(answer)
            results.append(await self._grade(str(question["id"]), answer, source))
        total = len(results)
        correct = sum(item["result"] == "correct" for item in results)
        partial = sum(item["result"] == "partial" for item in results)
        wrong = sum(item["result"] == "wrong" for item in results)
        wrong_rate = wrong / total
        non_correct_rate = (partial + wrong) / total
        if blank > 3 or non_correct_rate > 0.4:
            raise FlowError(
                f"首次作答不符合约束：空题 {blank}，非全对率 {non_correct_rate:.1%}"
            )

        corrections = []
        for question, use_reference, result in zip(
            self.questions, self.practice_correct_flags, results
        ):
            if use_reference or result["result"] == "correct":
                continue
            corrections.append(
                await self._grade(
                    str(question["id"]),
                    str(question["answer"]).strip(),
                    "reference_correction_for_task_completion",
                )
            )
        return {
            "questionCount": total,
            "answeredCount": total - blank,
            "blankCount": blank,
            "correct": correct,
            "partial": partial,
            "wrong": wrong,
            "actualAccuracy": round(correct / total, 4),
            "wrongRate": round(wrong_rate, 4),
            "nonCorrectRate": round(non_correct_rate, 4),
            "results": results,
            "correctedCount": len(corrections),
            "correctionResults": corrections,
        }

    async def verify_today_tasks(self) -> dict:
        body = await self.request(
            "GET", "/api/daily-selection", params={"date": self.today.isoformat()}
        )
        tasks = body.get("tasks") or []
        incomplete = [task["id"] for task in tasks if task.get("status") != "done"]
        if incomplete:
            raise FlowError(f"今日任务未全部通过练习验证：{incomplete}")
        return {"taskCount": len(tasks), "completedTaskIds": [task["id"] for task in tasks]}

    async def create_reinforcement_preview(self) -> dict:
        body = await self.request("POST", f"/api/plans/{self.plan_id}/reinforce-preview")
        adjustment = body.get("adjustment") or {}
        validation = adjustment.get("validation") or {}
        eligible = bool(validation.get("ok")) and bool(adjustment.get("id"))
        if eligible:
            self.adjustment_id = str(adjustment["id"])
            self.selection_version = int(adjustment.get("selectionVersion") or 1)
        return {
            "eligible": eligible,
            "adjustmentId": self.adjustment_id or None,
            "validation": validation,
        }

    async def confirm_reinforcement(self) -> dict:
        self.reinforcement_task_ids.clear()
        before = await self.request("GET", f"/api/phases/{self.phase_id}/tasks")
        before_ids = {task["id"] for task in before["tasks"]}
        body = await self.request(
            "POST",
            f"/api/plans/{self.plan_id}/adjustments/{self.adjustment_id}/confirm",
            json={"selectionVersion": self.selection_version},
        )
        adjustment = body.get("adjustment") or {}
        if adjustment.get("status") != "confirmed":
            raise FlowError("补强预览未进入 confirmed 状态")
        after = await self.request("GET", f"/api/phases/{self.phase_id}/tasks")
        self.reinforcement_task_ids = {task["id"] for task in after["tasks"]} - before_ids
        if not self.reinforcement_task_ids:
            raise FlowError("当前阶段未发现新增补强任务，停止完成和重测")
        return {"adjustmentId": self.adjustment_id, "status": "confirmed"}

    async def complete_reinforcement_tasks(self) -> dict:
        body = await self.request("GET", f"/api/phases/{self.phase_id}/tasks")
        completed = 0
        for task in body.get("tasks") or []:
            if task.get("id") not in self.reinforcement_task_ids or task.get("status") == "done":
                continue
            await self.request(
                "PATCH", f"/api/daily-tasks/{task['id']}/status", json={"status": "done"}
            )
            completed += 1
        return {"phaseId": self.phase_id, "completedTasks": completed}

    async def generate_retest(self) -> dict:
        body = await self.request(
            "POST", "/api/practice/reinforce-retest", json={"phaseId": self.phase_id}
        )
        questions = body.get("questions") or []
        if not questions or not questions[0].get("answer"):
            raise FlowError("补强重测未返回带参考答案的题目")
        previous_id = self.question_id
        self.question_id = str(questions[0]["id"])
        self.answer = str(questions[0]["answer"])
        if self.question_id == previous_id:
            raise FlowError("补强重测错误地复用了原题")
        return {"previousQuestionId": previous_id, "retestQuestionId": self.question_id}

    async def grade_retest(self) -> dict:
        return await self._grade(
            self.question_id, self.answer, "reference_for_retest_verification"
        )

    async def verify_weekly_review(self) -> dict:
        body = await self.request("GET", "/api/weekly-reviews/latest")
        review = body.get("review") or {}
        if body.get("empty") or not all(review.get(key) for key in ("weekStart", "weekEnd", "createdAt")):
            raise FlowError("周报未生成或缺少周起止日期、生成时间")
        outcomes = review.get("reinforceOutcomes") or []
        return {"reviewAvailable": bool(review), "reinforcementOutcomes": len(outcomes)}

    async def verify_metrics(self) -> dict:
        body = await self.request("GET", "/api/metrics/overview", params={"today": self.today.isoformat()})
        return {
            "totalMinutes": body.get("totalMinutes"),
            "todayStatus": body.get("todayStatus"),
            "phaseProgress": body.get("phaseProgress"),
        }

    async def generate_diagnosis(self) -> dict:
        body = await self.request("POST", "/api/statistics/diagnosis")
        report = body.get("report") or {}
        if not report:
            raise FlowError("诊断接口未返回报告")
        return {"reportId": report.get("id"), "generated": True}

    async def logout(self) -> dict:
        await self.request("POST", "/api/auth/logout")
        return {"status": "ok"}


async def execute(report: dict) -> None:
    load_env_file()
    report["baseUrl"] = os.environ.get("STUDYPILOT_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
    report["username"] = os.environ.get("STUDYPILOT_USERNAME", "super")
    if not os.environ.get("STUDYPILOT_PASSWORD"):
        raise FlowError("缺少 STUDYPILOT_PASSWORD；请设置环境变量或创建 .ai-handoff/user-flow.env")

    flow = UserFlow(report)
    if not flow.material_path.is_file():
        raise FlowError(f"当日专题讲义不存在：{flow.material_path}")
    base_url = report["baseUrl"]
    timeout = httpx.Timeout(300.0, connect=10.0)
    logged_in = False
    async with httpx.AsyncClient(base_url=base_url, timeout=timeout, trust_env=False) as client:
        flow.client = client
        try:
            await flow.step("health", flow.health)
            await flow.step("login", flow.login)
            logged_in = True
            await flow.step("upload_material", flow.upload_material)
            await flow.step("verify_document", flow.verify_document)
            await flow.step("generate_plan", flow.generate_plan)
            await flow.step("start_plan_today", flow.start_plan_today)
            await flow.step("verify_plan", flow.verify_plan)
            await flow.step("select_today_tasks", flow.select_today_tasks)
            await flow.step("complete_today_learning", flow.complete_today_learning)
            await flow.step("check_in", flow.check_in)
            await flow.step("generate_practice", flow.generate_practice)
            await flow.step("grade_practice", flow.grade_practice)
            await flow.step("verify_today_tasks", flow.verify_today_tasks)
            await flow.step("create_reinforcement_preview", flow.create_reinforcement_preview)
            if flow.adjustment_id:
                await flow.step("confirm_reinforcement", flow.confirm_reinforcement)
                await flow.step("complete_reinforcement_tasks", flow.complete_reinforcement_tasks)
                await flow.step("generate_retest", flow.generate_retest)
                await flow.step("grade_retest", flow.grade_retest)
            await flow.step("verify_weekly_review", flow.verify_weekly_review)
            await flow.step("verify_metrics", flow.verify_metrics)
            await flow.step("generate_diagnosis", flow.generate_diagnosis)
            await flow.step("logout", flow.logout)
            logged_in = False
        finally:
            if logged_in:
                try:
                    await flow.step("logout", flow.logout)
                except Exception:
                    pass


def main() -> int:
    report = {
        "runId": uuid.uuid4().hex,
        "status": "running",
        "startedAt": iso_now(),
        "finishedAt": None,
        "durationMs": None,
        "baseUrl": os.environ.get("STUDYPILOT_BASE_URL", "http://127.0.0.1:8000"),
        "username": os.environ.get("STUDYPILOT_USERNAME", "super"),
        "material": str(material_for_day(date.today()).relative_to(ROOT)),
        "steps": [],
        "error": None,
    }
    started = time.monotonic()
    try:
        asyncio.run(execute(report))
        failed = [step for step in report["steps"] if step.get("status") == "failed"]
        report["status"] = "partial" if failed else "success"
    except Exception as error:
        report["status"] = "failed"
        report["error"] = f"{type(error).__name__}: {error}"
    finally:
        report["finishedAt"] = iso_now()
        report["durationMs"] = round((time.monotonic() - started) * 1000)
        REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with REPORT_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(report, ensure_ascii=False) + "\n")

    print(
        f"运行结果：{report['status']}；runId={report['runId']}；报告={REPORT_PATH}",
        flush=True,
    )
    if report.get("retries"):
        print(f"重试记录：{len(report['retries'])} 次（详见报告 retries 字段）", flush=True)
    if report["error"]:
        print(f"错误：{report['error']}", flush=True)
    if report["status"] == "partial":
        failed = [step["name"] for step in report["steps"] if step.get("status") == "failed"]
        print(f"降级提示：主流程已完成，非关键步骤失败：{', '.join(failed)}", flush=True)
    return {"success": 0, "partial": 2, "failed": 1}.get(report["status"], 1)


if __name__ == "__main__":
    raise SystemExit(main())
