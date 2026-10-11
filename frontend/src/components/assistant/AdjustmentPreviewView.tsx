/**
 * 调整预览：逐条依据、预计分钟、分日合计、约束结果与取舍。
 */
import type { EvidenceRef, PlanAdjustmentPreview } from '@/lib/plansApi';
import {
  adjustmentCanConfirm,
  effectivePreviewTasks,
  isRemedyConfirmContract,
  localSelectionDirty,
  minuteDraftState,
  minuteInputValue,
  sourcePlaceLabel,
} from '@/lib/adjustmentPreviewActions';

export function checkLabel(value: unknown): string {
  if (value === 'pass') return '通过';
  if (value === 'fail') return '失败';
  if (value === 'unknown') return '未知';
  if (value === 'insufficient') return '不足';
  if (value === 'unverified') return '未验证';
  return String(value ?? '未验证');
}

export interface AdjustmentPreviewViewProps {
  pending: PlanAdjustmentPreview | null;
  showUndo: boolean;
  busy?: boolean;
  keptActionIds?: string[];
  minuteTexts?: Record<string, string>;
  onConfirm: () => void;
  onReject: () => void;
  onUndo: () => void;
  onToggleAction?: (actionId: string, keep: boolean) => void;
  onMinutes?: (actionId: string, raw: string) => void;
  onRevise?: () => void;
  onOpenSource?: (ref: EvidenceRef) => void;
  remedyOption?: string;
  onRemedyOption?: (optionId: string) => void;
  extraDirty?: boolean;
}

function durationDays(pending: PlanAdjustmentPreview): Array<Record<string, unknown>> {
  const raw = pending.validation?.durationDays;
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

export function AdjustmentPreviewView({
  pending,
  showUndo,
  busy = false,
  keptActionIds,
  minuteTexts = {},
  onConfirm,
  onReject,
  onUndo,
  onToggleAction,
  onMinutes,
  onRevise,
  onOpenSource,
  remedyOption,
  onRemedyOption,
  extraDirty = false,
}: AdjustmentPreviewViewProps) {
  if (!pending && !showUndo) return null;

  const checks = (pending?.validation?.checks ?? {}) as Record<string, unknown>;
  const proposed = pending?.diff.proposedPending ?? [];
  const rows = pending ? effectivePreviewTasks(pending) : [];
  const remedy = pending?.diff.remedy;
  const serverIds = remedy
    ? remedy.candidates
        .map((item) => item.sourceId)
        .filter(
          (id) =>
            !remedy.notArranged.some(
              (item) => item.sourceId === id && item.reason === '本次不补做',
            ),
        )
    : proposed
        .map((item) => item.actionId)
        .filter((id): id is string => Boolean(id));
  const minuteState = minuteDraftState(minuteTexts);
  const selectionDirty =
    pending != null &&
    keptActionIds != null &&
    (localSelectionDirty(serverIds, keptActionIds, minuteTexts) ||
      minuteState.invalidIds.length > 0 ||
      extraDirty);
  const canConfirm = pending
    ? adjustmentCanConfirm(pending.validation) && !selectionDirty
    : false;
  const remedyContract = pending ? isRemedyConfirmContract(pending.validation) : false;
  const days = pending ? durationDays(pending) : [];
  const refs = pending?.evidenceRefs ?? [];
  const planChanges = pending?.diff.planChanges ?? [];
  const keptTasks = pending?.diff.keptTasks ?? [];
  const dateNote = pending?.validation?.dateAdjustment as
    | { kind?: string; deltaDays?: number }
    | undefined;

  return (
    <div className="shrink-0 space-y-2 border-t border-brandFaint bg-white/70 px-3 py-2 text-xs text-brandDark">
      {pending ? (
        <>
          <p className="font-medium">调整预览（尚未写入）· 计划 {pending.planId.slice(0, 8)}…</p>
          <p className="whitespace-pre-wrap text-brandDark/80">{pending.decisionSummary}</p>
          {pending.diff.remedy ? (
            <div className="space-y-1 rounded-lg bg-brandFaint/40 p-2">
              <p>
                已完成 {pending.diff.remedy.doneCount} 条 · 今日已记录投入{' '}
                {pending.diff.remedy.recordedMinutes == null
                  ? '未记录'
                  : `${pending.diff.remedy.recordedMinutes} 分钟`}
                {pending.diff.remedy.todayAvailable == null
                  ? ' · 实际剩余未知'
                  : ` · 今日可用 ${pending.diff.remedy.todayAvailable} 分钟`}
                {pending.diff.remedy.overLimit ? ' · 今日已超限' : ''}
              </p>
              {pending.diff.remedy.phaseHistoryUnchanged ? (
                <p>阶段历史结束日未改。新补做可以排在该日期之后。</p>
              ) : null}
              {pending.diff.remedy.dailyMinutes != null ? (
                <p>每日上限 {pending.diff.remedy.dailyMinutes} 分钟。这是用户容量约束。</p>
              ) : null}
              {refs
                .filter((ref) => ref.kind === 'checkin')
                .map((ref, index) => (
                  <p key={ref.checkInId ?? `checkin-${index}`}>
                    日级打卡 {ref.checkDate ?? ''} · 已记录 {ref.durationMinutes ?? ''} 分钟 · 难度{' '}
                    {ref.difficulty ?? ''} · 精力 {ref.energy ?? ''}
                    {ref.note ? ` · 备注 ${ref.note}` : ''}
                    。这是当天记录，不分配到某条任务，也不作为排程原因。
                  </p>
                ))}
              {refs
                .filter((ref) => ref.kind === 'practice')
                .map((ref, index) => (
                  <p key={`practice-${index}`}>
                    补充练习 {ref.text ?? ''}。不参与容量，不单独改期。
                  </p>
                ))}
              <div className="flex flex-wrap gap-1">
                {pending.diff.remedy.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="rounded border border-brand/40 px-2 py-1"
                    aria-pressed={
                      (remedyOption ?? pending.diff.remedy?.selectedOption) === option.id
                    }
                    onClick={() => onRemedyOption?.(option.id)}
                  >
                    {option.label}
                    {option.ok ? '' : '（当前放不下）'}
                  </button>
                ))}
              </div>
              <p>本次安排 {pending.diff.remedy.arranged.length} 条</p>
              {pending.diff.remedy.arranged.map((item) => (
                <p key={item.sourceId}>
                  {item.taskDate} · {item.description}
                  {item.phaseEnd ? ` · 阶段历史结束日 ${item.phaseEnd}` : ''}
                </p>
              ))}
              <p>未安排 {pending.diff.remedy.notArranged.length} 条。取消勾选是本次不补做，原任务仍待补，不增加完成数。</p>
              {pending.diff.remedy.candidates.map((item) => {
                const kept = !keptActionIds || keptActionIds.includes(item.sourceId);
                const minuteText = minuteInputValue(
                  minuteTexts,
                  item.sourceId,
                  item.estimatedMinutes,
                );
                const minuteInvalid = minuteState.invalidIds.includes(item.sourceId);
                const linked = refs.filter(
                  (ref) =>
                    ref.actionId === item.sourceId ||
                    (ref.actionIds ?? []).includes(item.sourceId),
                );
                return (
                  <div key={item.sourceId} className="space-y-1">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={kept}
                      aria-label={`本次安排 ${item.description}`}
                      onChange={(event) =>
                        onToggleAction?.(item.sourceId, event.target.checked)
                      }
                    />
                    <span>
                      {item.taskDate} · {item.description}
                      {item.estimatedMinutes == null ? ' · 预计未知' : ` · 预计 ${item.estimatedMinutes} 分钟`}
                    </span>
                    <input
                      className="w-16 rounded border border-brand/30 px-1 py-0.5"
                      inputMode="numeric"
                      aria-label={`${item.description} 预计分钟`}
                      aria-invalid={minuteInvalid}
                      placeholder="分钟"
                      value={minuteText}
                      onChange={(event) => onMinutes?.(item.sourceId, event.target.value)}
                    />
                  </label>
                  {linked.map((ref, refIndex) => (
                    <p key={`${item.sourceId}-fact-${refIndex}`}>
                      本任务事实：{ref.taskDate ?? ''} {ref.description ?? ''}
                    </p>
                  ))}
                  </div>
                );
              })}
              {pending.diff.remedy.notArranged.map((item) => (
                <p key={`${item.sourceId}-${item.reason}`}>
                  {item.description} · {item.reason}
                </p>
              ))}
            </div>
          ) : null}

          <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg bg-brandFaint/40 p-2">
            <p className="font-medium text-brandDark/90">将替换的任务</p>
            {pending.diff.removedOrReplaced.length === 0 ? (
              <p className="text-brandDark/60">无</p>
            ) : (
              pending.diff.removedOrReplaced.map((item) => (
                <p key={item.id}>
                  {item.taskDate} · {item.description}
                  <span className="text-brandDark/50">（{item.status}）</span>
                  {item.estimatedMinutes == null
                    ? ' · 预计未知'
                    : ` · 预计 ${item.estimatedMinutes} 分钟`}
                </p>
              ))
            )}
            <p className="pt-1 font-medium text-brandDark/90">拟写入的任务</p>
            {rows.length === 0 ? (
              <p className="text-brandDark/60">无</p>
            ) : (
              rows.map((item, index) => {
                const actionId = item.actionId ?? `row-${index}`;
                const kept = !keptActionIds || keptActionIds.includes(actionId);
                const linked = refs.filter(
                  (ref) =>
                    ref.actionId === actionId ||
                    (ref.actionIds ?? []).includes(actionId),
                );
                const minuteText = minuteInputValue(
                  minuteTexts,
                  actionId,
                  item.estimatedMinutes,
                );
                const minuteInvalid = minuteState.invalidIds.includes(actionId);
                return (
                  <div key={actionId} className="space-y-1">
                    <label className="flex flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        checked={kept}
                        aria-label={`保留 ${item.description}`}
                        onChange={(event) =>
                          onToggleAction?.(actionId, event.target.checked)
                        }
                      />
                      <span>
                        {item.taskDate} · {item.description}
                        {item.estimatedMinutes == null
                          ? ' · 预计未知'
                          : ` · 预计 ${item.estimatedMinutes} 分钟`}
                      </span>
                      <input
                        className="w-16 rounded border border-brand/30 px-1 py-0.5"
                        inputMode="numeric"
                        aria-label={`${item.description} 预计分钟`}
                        aria-invalid={minuteInvalid}
                        placeholder="分钟"
                        value={minuteText}
                        onChange={(event) => onMinutes?.(actionId, event.target.value)}
                      />
                      {minuteInvalid ? (
                        <span className="text-red-700">预计分钟必须是正整数</span>
                      ) : null}
                    </label>
                    {linked.map((ref, refIndex) => (
                      <p key={`${actionId}-evidence-${refIndex}`} className="pl-6">
                        {ref.kind === 'document'
                          ? `本任务依据（建议，不是已证实）：${sourcePlaceLabel(ref)} ${ref.snippet ?? ''}`
                          : ref.kind === 'constraint'
                            ? `本任务约束：${ref.text ?? ''}`
                            : `本任务事实：${ref.taskDate ?? ''} ${ref.description ?? ''}`}
                        {ref.matchedTerms?.length
                          ? ` · 命中 ${ref.matchedTerms.join('、')}`
                          : ''}
                        {ref.kind === 'document' ? (
                          <button
                            type="button"
                            className="ml-2 underline"
                            onClick={() => onOpenSource?.(ref)}
                          >
                            打开来源
                          </button>
                        ) : null}
                      </p>
                    ))}
                  </div>
                );
              })
            )}
          </div>

          <div className="space-y-0.5 text-brandDark/70">
            <p className="font-medium text-brandDark/90">规划约束变化</p>
            {planChanges.length === 0 ? (
              <p>规划字段无变化</p>
            ) : (
              planChanges.map((change) => (
                <p key={change.field}>
                  {change.field}：{String(change.before)} → {String(change.after)}
                </p>
              ))
            )}
            <p className="pt-1 font-medium text-brandDark/90">保留的任务</p>
            {keptTasks.length === 0 ? (
              <p>无额外保留项</p>
            ) : (
              keptTasks.map((item) => (
                <p key={item.id}>
                  {item.taskDate} · {item.description}
                  <span className="text-brandDark/50">（{item.status}）</span>
                  {item.estimatedMinutes == null
                    ? ' · 预计未知'
                    : ` · 预计 ${item.estimatedMinutes} 分钟`}
                </p>
              ))
            )}
            {dateNote?.deltaDays ? (
              <p>建议将日程整体后移 {dateNote.deltaDays} 天，预览中的日期已是平移后的结果。</p>
            ) : null}
            <p className="pt-1 font-medium text-brandDark/90">分日合计</p>
            {days.length === 0 ? (
              <p>尚无分日合计</p>
            ) : (
              days.map((day) => (
                <p key={String(day.date)}>
                  {String(day.date)} · 已知 {String(day.knownMinutes ?? 0)} 分钟 · 未知{' '}
                  {String(day.unknownCount ?? 0)} 条 · 上限 {String(day.cap ?? '')} 分钟 ·{' '}
                  {checkLabel(day.result)}
                </p>
              ))
            )}
            {checks.duration === 'fail' ? (
              <p>超出上限的日期请勾选拟写入项或填写预计分钟后重新计算。不会自动删任务或缩短历史。</p>
            ) : null}
          </div>

          <div className="space-y-0.5 text-brandDark/70">
            <p className="font-medium text-brandDark/90">执行步骤</p>
            {(pending.steps ?? []).map((step, index) => (
              <p key={index}>
                {String(step.step ?? 'step')} → {String(step.result ?? '')}
              </p>
            ))}
            <p className="pt-1 font-medium text-brandDark/90">规则结果</p>
            {remedyContract ? (
              <p>容量：{checkLabel(checks.capacity)}</p>
            ) : (
              <>
                <p>结构：{checkLabel(checks.structure)}</p>
                <p>历史保护：{checkLabel(checks.protectedTaskRule)}</p>
                <p>证据定位：{checkLabel(checks.evidenceLocation)}</p>
                <p>时长校验：{checkLabel(checks.duration)}</p>
                <p>日期约束：{checkLabel(checks.schedule)}</p>
              </>
            )}
            <p>选择：{checkLabel(checks.selection)}</p>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={busy || !canConfirm}
              className="rounded-lg bg-brand px-3 py-1.5 text-white disabled:opacity-50"
              onClick={onConfirm}
            >
              确认写入
            </button>
            <button
              type="button"
              disabled={busy || !onRevise}
              className="rounded-lg border border-brand/40 px-3 py-1.5 disabled:opacity-50"
              onClick={onRevise}
            >
              重新计算
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-brand/40 px-3 py-1.5 disabled:opacity-50"
              onClick={onReject}
            >
              拒绝
            </button>
          </div>
        </>
      ) : null}
      {showUndo ? (
        <button
          type="button"
          disabled={busy}
          className="text-left text-brandDark/70 underline-offset-2 hover:underline disabled:opacity-50"
          onClick={onUndo}
        >
          撤销最近一次已确认调整
        </button>
      ) : null}
    </div>
  );
}
