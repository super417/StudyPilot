/**
 * 调整目标计划：优先当前查看/选中的计划，其次最近生成的 planId。
 */
export function resolvePlanTargetId(
  activePlanId: string | null | undefined,
  lastPlanId: string | null | undefined,
): string | null {
  return activePlanId ?? lastPlanId ?? null;
}
