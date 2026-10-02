import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { getModelLabel, type ModelId, type ModelOption } from '@/lib/modelPrefs';

export interface ModelSelectProps {
  value: ModelId;
  options: readonly ModelOption[];
  onChange: (id: ModelId) => void;
  loading?: boolean;
  error?: string | null;
  emptyHint?: string;
  disabled?: boolean;
}

/**
 * 选择模型下拉：选项由调用方传入（来自用户 API 的 /models），
 * 无硬编码默认模型。当前选中项右侧显示勾选。
 */
function ModelSelect({
  value,
  options,
  onChange,
  loading = false,
  error = null,
  emptyHint = '请先填写 API Key 与 Base URL，以加载可用模型',
  disabled = false,
}: ModelSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const select = (id: ModelId) => {
    onChange(id);
    setOpen(false);
  };

  const renderOption = (id: ModelId, label: string) => {
    const active = id === value;
    return (
      <button
        key={id}
        type="button"
        role="option"
        aria-selected={active}
        onClick={() => select(id)}
        className={`flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-sm transition ${
          active ? 'bg-brandFaint text-brandDark' : 'text-brandDark hover:bg-bg'
        }`}
      >
        <span className="truncate font-medium">{label}</span>
        {active ? <Check size={16} className="shrink-0 text-brand" aria-hidden="true" /> : null}
      </button>
    );
  };

  const triggerLabel = loading
    ? '加载模型中…'
    : value
      ? getModelLabel(value, options)
      : options.length
        ? '请选择模型'
        : '暂无可用模型';

  return (
    <div className="relative" ref={rootRef}>
      <label className="mb-1 block text-sm font-medium text-brandDark">选择模型</label>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled || loading}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-full border border-brandFaint bg-white px-3.5 py-2.5 text-sm text-brandDark outline-none transition hover:border-brand focus:border-brand disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {loading ? <Loader2 size={14} className="shrink-0 animate-spin text-brand" aria-hidden="true" /> : null}
          <span className="truncate">{triggerLabel}</span>
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-dangerText">
          {error}
        </p>
      ) : null}

      <AnimatePresence>
        {open ? (
          <motion.div
            role="listbox"
            aria-label="选择模型"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-[20px] border border-brandFaint bg-card p-2 shadow-[0_16px_48px_rgba(6,78,59,0.14)]"
          >
            {options.length === 0 ? (
              <p className="px-3 py-2 text-sm text-gray-400">{emptyHint}</p>
            ) : (
              <>
                <p className="px-3 pb-1 pt-1 text-xs font-medium text-gray-400">可用模型</p>
                {options.map((o) => renderOption(o.id, o.label))}
              </>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default ModelSelect;
