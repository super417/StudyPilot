# 第 22 批：首屏考研定位文案清理

依据：`docs/direction.md` §10.19。只改两处可见文案，没有新增任何文案常量，也没有增加 `cohort` 字段或替代名称。

- `GoalCard.tsx`：`LEARNING CYCLE · postgrad-2028` 改为 `LEARNING CYCLE`。
- `MetricsRow.tsx`：剩余天数后缀 `天到初试` 改为 `天`。

## 验收

- `npm run test`：34 个文件、133 条测试通过。
- `npm run typecheck`（`tsc --noEmit`）：通过。
- 同一路由 `/`、同一第 18/21 批 B2 验收账号重拍首屏：`../../.ai-handoff/batch22-logs/B1-overview-ready.png`。图片已开图核对：目标卡首行只显示 `LEARNING CYCLE`；指标行第一项显示 `60 天`。本次 Vite 使用本地端口 5174（5173 已被占用），路由与账号未变。

本批没有修改 `planner_service.py` 的兜底阶段名、注释、`resourceRequest.ts` 识别规则或 `targetSchool` 列名。
