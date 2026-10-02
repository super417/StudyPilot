import { useState, type FormEvent } from 'react';

/** 打卡表单提交负载（对应 Check_Ins 表可写字段的前端子集） */
export interface CheckInFormValues {
  /** 实际学习时长（分钟） */
  durationMinutes: number;
  /** 主观难度 1-5 */
  difficulty: number;
  /** 精力状态 1-5 */
  energy: number;
  /** 备注 */
  note: string;
}

export interface CheckInFormProps {
  /** 时长输入的初始值（分钟），默认 60 */
  initialDurationMinutes?: number;
  /** 完成打卡回调；总览页传入后会 POST /api/check-ins。 */
  onSubmit?: (values: CheckInFormValues) => void;
}

/** 1-5 评分刻度 */
const SCALE = [1, 2, 3, 4, 5] as const;

/**
 * CheckInForm — 总览页打卡表单（需求 4.6）
 * 本地受控：学习分钟、主观难度、精力、备注；提交交由父组件写库。
 */
function CheckInForm({ initialDurationMinutes = 60, onSubmit }: CheckInFormProps) {
  const [durationMinutes, setDurationMinutes] = useState<number>(initialDurationMinutes);
  const [difficulty, setDifficulty] = useState<number>(3);
  const [energy, setEnergy] = useState<number>(3);
  const [note, setNote] = useState<string>('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values: CheckInFormValues = { durationMinutes, difficulty, energy, note };
    onSubmit?.(values);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[24px] bg-white/95 p-5 text-brandDark shadow-sm"
    >
      <p className="text-sm font-semibold text-brandDark">今日打卡</p>

      {/* 实际学习分钟 */}
      <label className="mt-4 block">
        <span className="text-xs font-medium text-gray-500">实际学习分钟</span>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={durationMinutes}
          onChange={(event) => setDurationMinutes(Number(event.target.value))}
          className="mt-1.5 w-full rounded-xl border border-brandFaint bg-white px-3 py-2 font-display text-lg font-semibold text-brandDark outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </label>

      {/* 主观难度 1-5 */}
      <ScaleField label="主观难度" value={difficulty} onSelect={setDifficulty} />

      {/* 精力状态 1-5 */}
      <ScaleField label="精力状态" value={energy} onSelect={setEnergy} />

      {/* 备注 */}
      <label className="mt-4 block">
        <span className="text-xs font-medium text-gray-500">备注</span>
        <textarea
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="今天的学习感受 / 遇到的问题…"
          className="mt-1.5 w-full resize-none rounded-xl border border-brandFaint bg-white px-3 py-2 text-sm text-brandDark outline-none placeholder:text-gray-400 focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </label>

      <button
        type="submit"
        className="btn-pill mt-5 w-full px-6 py-3 text-sm font-semibold"
      >
        完成打卡
      </button>
    </form>
  );
}

interface ScaleFieldProps {
  /** 字段标签 */
  label: string;
  /** 当前选中值 1-5 */
  value: number;
  /** 选择回调 */
  onSelect: (value: number) => void;
}

/** 1-5 可选按钮组（本地受控，选中态高亮主色） */
function ScaleField({ label, value, onSelect }: ScaleFieldProps) {
  return (
    <div className="mt-4">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <div className="mt-1.5 grid grid-cols-5 gap-1.5">
        {SCALE.map((n) => {
          const selected = n === value;
          return (
            <button
              key={n}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(n)}
              className={
                selected
                  ? 'rounded-xl bg-brand py-2 font-display text-sm font-semibold text-white'
                  : 'rounded-xl bg-brandFaint py-2 font-display text-sm font-semibold text-brandDark hover:bg-brandLight'
              }
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default CheckInForm;
