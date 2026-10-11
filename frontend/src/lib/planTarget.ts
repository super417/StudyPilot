/**
 * 调整目标计划：优先当前查看/选中的计划，其次最近生成的 planId。
 */
export function resolvePlanTargetId(
  activePlanId: string | null | undefined,
  lastPlanId: string | null | undefined,
): string | null {
  return activePlanId ?? lastPlanId ?? null;
}

/** 有打开的预览时，撤销必须打到这份预览的计划，而不是另一个残留计划。 */
export function resolveUndoPlanId(
  pendingPlanId: string | null | undefined,
  activePlanId: string | null | undefined,
  lastPlanId: string | null | undefined,
): string | null {
  if (pendingPlanId) return pendingPlanId;
  return resolvePlanTargetId(activePlanId, lastPlanId);
}
