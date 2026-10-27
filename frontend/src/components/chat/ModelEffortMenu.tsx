/**
 * 输入条上沿的「模型 · 思考强度」折叠入口。
 *
 * 外观刻意贴着 `AssistantInput` 那套深色胶囊：近黑绿底（#04150e）、
 * 青绿描边与文字，不引入新的白卡片，也不改输入条本身的底色/材质/动效。
 *
 * 菜单两段：
 *   Model            —— 模型列表来自用户 API 的 /models（无多模型时只展示当前配置的那个）
 *   Reasoning Effort —— Low / Medium / High，写回 `lib/modelPrefs`，
 *                       发送时由 `assistantApi` 透传 reasoningStrength，后端据此调温度与推理档。
 *
 * 模型选择目前只记偏好（后端仍按 API 配置里的 modelType 调用）——
 * 主人说的「无多模型时先 UI 打通」就是这一步。
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Sparkles } from 'lucide-react';

import { getApiConfig, listApiModels } from '@/lib/apiConfigApi';
import {
  getModelLabel,
  getModelPrefs,
  setModel,
  setStrength,
  type ModelOption,
  type StrengthId,
} from '@/lib/modelPrefs';

/** 菜单只暴露三档，与后端 `apply_reasoning_strength` 的 low / standard / high 一一对应。 */
const EFFORT_ROWS: readonly { id: StrengthId; label: string; hint: string }[] = [
  { id: 'low', label: 'Low', hint: '最快响应，适合简单问答与草稿' },
  { id: 'standard', label: 'Medium', hint: '日常学习与一般问答' },
  { id: 'high', label: 'High', hint: '更充分的推理，适合复杂题目讲解' },
];

/** 旧偏好里的 deep 档在后端等同 high，菜单统一显示 High。 */
function toMenuEffort(id: StrengthId): StrengthId {
  return id === 'deep' ? 'high' : id;
}

function effortLabel(id: StrengthId): string {
  return EFFORT_ROWS.find((row) => row.id === toMenuEffort(id))?.label ?? 'High';
}

const ITEM_BASE =
  'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors';

function ModelEffortMenu() {
  const [open, setOpen] = useState(false);
  const [model, setModelState] = useState(() => getModelPrefs().model);
  const [effort, setEffortState] = useState<StrengthId>(() =>
    toMenuEffort(getModelPrefs().strength),
  );
  const [configured, setConfigured] = useState('');
  const [options, setOptions] = useState<ModelOption[] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    getApiConfig()
      .then((cfg) => {
        if (!active) return;
        setConfigured(cfg.modelType);
        // 没选过模型就跟随后端当前配置，保证入口显示的就是真实在跑的模型
        setModelState((prev) => prev || cfg.modelType);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // 模型列表按需拉：只有真点开菜单才请求；失败就退回「只有当前模型」的只读态。
  useEffect(() => {
    if (!open || options) return;
    let active = true;
    listApiModels()
      .then((rows) => {
        if (active) setOptions(rows.map((row) => ({ id: row.id, label: row.name || row.id })));
      })
      .catch(() => {
        if (active) setOptions([]);
      });
    return () => {
      active = false;
    };
  }, [open, options]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // 拦在 document 上：否则同一次 Esc 会继续冒泡到 window，把整个聊天面板关掉。
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const currentModelId = model || configured;
  const modelLabel = currentModelId
    ? getModelLabel(currentModelId, options ?? undefined)
    : '未配置模型';

  const chooseModel = (id: string) => {
    setModelState(id);
    setModel(id);
  };

  const chooseEffort = (id: StrengthId) => {
    setEffortState(id);
    setStrength(id);
  };

  const activeHint = EFFORT_ROWS.find((row) => row.id === effort)?.hint ?? '';

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="模型与思考强度"
        title="模型 · 思考强度"
        onClick={() => setOpen((value) => !value)}
        className="flex h-8 max-w-full items-center gap-1.5 rounded-full border border-[rgba(6,78,59,0.65)] bg-[#04150e] px-3 text-[12px] text-[#a7f3d0] transition-colors hover:border-[rgba(16,185,129,0.65)] hover:text-[#d1fae5]"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#34d399]" aria-hidden="true" />
        <span className="max-w-[240px] truncate">{modelLabel}</span>
        <span className="text-[#6ee7b7]/50" aria-hidden="true">
          ·
        </span>
        <span className="shrink-0">{effortLabel(effort)}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[#6ee7b7]/70 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="模型与思考强度"
          className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[304px] max-w-[calc(100vw-32px)] rounded-2xl border border-[rgba(6,78,59,0.75)] bg-[#04150e] p-3 text-[#d1fae5] shadow-[0_18px_44px_rgba(0,0,0,0.45)]"
        >
          <p className="px-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[#6ee7b7]/70">
            Model
          </p>
          <div className="mt-1.5 space-y-0.5">
            {options === null ? (
              <p className="px-2 py-1.5 text-[12px] text-[#a7f3d0]/50">读取模型列表…</p>
            ) : options.length ? (
              options.map((option) => {
                const active = option.id === currentModelId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => chooseModel(option.id)}
                    className={`${ITEM_BASE} ${
                      active
                        ? 'bg-[rgba(16,185,129,0.16)] text-[#6ee7b7]'
                        : 'text-[#a7f3d0]/75 hover:bg-white/5'
                    }`}
                  >
                    <span className="truncate">{option.label}</span>
                    {active ? (
                      <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })
            ) : (
              <p className="px-2 py-1.5 text-[12px] leading-relaxed text-[#a7f3d0]/55">
                {configured ? `当前仅一个模型：${configured}` : '尚未配置模型，先去个人中心填 API Key'}
              </p>
            )}
          </div>

          <div className="my-2.5 h-px bg-[rgba(6,78,59,0.8)]" aria-hidden="true" />

          <p className="px-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[#6ee7b7]/70">
            Reasoning Effort
          </p>
          <div className="mt-1.5 flex gap-1.5">
            {EFFORT_ROWS.map((row) => {
              const active = row.id === effort;
              return (
                <button
                  key={row.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => chooseEffort(row.id)}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-[12px] font-medium transition-colors ${
                    active
                      ? 'bg-[rgba(16,185,129,0.18)] text-[#6ee7b7] ring-1 ring-[rgba(16,185,129,0.45)]'
                      : 'text-[#a7f3d0]/65 hover:bg-white/5'
                  }`}
                >
                  {row.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-[#a7f3d0]/45">{activeHint}</p>
        </div>
      ) : null}
    </div>
  );
}

export default ModelEffortMenu;
