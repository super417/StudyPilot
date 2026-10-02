import { STRENGTH_OPTIONS, getStrengthOption, type StrengthId } from '@/lib/modelPrefs';

export interface StrengthSliderProps {
  value: StrengthId;
  onChange: (id: StrengthId) => void;
}

/**
 * 推理强度「四档离散滑杆」：低 / 标准 / 高 / 深度。
 * 选中档位会写入本地偏好，并在助手对话、规划生成请求中透传给后端，
 * 映射为 temperature / reasoning_effort（及 DeepSeek thinking）参数。
 */
function StrengthSlider({ value, onChange }: StrengthSliderProps) {
  const rawIndex = STRENGTH_OPTIONS.findIndex((o) => o.id === value);
  const index = rawIndex < 0 ? 1 : rawIndex;
  const current = getStrengthOption(value);
  const maxIndex = STRENGTH_OPTIONS.length - 1;
  const fillPercent = maxIndex > 0 ? (index / maxIndex) * 100 : 0;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <label htmlFor="strength-range" className="text-sm font-medium text-brandDark">
          推理强度
        </label>
        <span className="rounded-full bg-brandFaint px-2.5 py-0.5 text-xs font-medium text-brandDark">
          {current.label}
        </span>
      </div>

      <div className="relative h-6 select-none px-2">
        {/* 轨道底色 */}
        <div className="absolute inset-x-2 top-1/2 h-2 -translate-y-1/2 rounded-full bg-brandFaint" />
        {/* 已激活段填充 */}
        <div
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-brand transition-all"
          style={{ left: '0.5rem', width: `calc((100% - 1rem) * ${fillPercent / 100})` }}
        />
        {/* 四个刻度圆点 */}
        {STRENGTH_OPTIONS.map((o, i) => {
          const pct = maxIndex > 0 ? (i / maxIndex) * 100 : 0;
          const reached = i <= index;
          return (
            <span
              key={o.id}
              aria-hidden="true"
              className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-colors ${
                reached ? 'border-brand bg-brand' : 'border-brandFaint bg-white'
              }`}
              style={{ left: `calc(0.5rem + (100% - 1rem) * ${pct / 100})` }}
            />
          );
        })}
        {/* 可拖动圆形滑块 */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand bg-white shadow-[0_2px_8px_rgba(6,78,59,0.25)] transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2"
          style={{ left: `calc(0.5rem + (100% - 1rem) * ${fillPercent / 100})` }}
        />
        {/* 透明原生 range：承载键盘与点击定位（step=1 → 只能停在四档） */}
        <input
          id="strength-range"
          type="range"
          min={0}
          max={maxIndex}
          step={1}
          value={index}
          onChange={(e) => onChange(STRENGTH_OPTIONS[Number(e.target.value)].id)}
          aria-valuetext={current.label}
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>

      {/* 档位名（点击可切档，键盘由上方 range 承载） */}
      <div className="mt-2 flex justify-between px-0.5 text-xs text-gray-400">
        {STRENGTH_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`transition ${
              o.id === value ? 'font-semibold text-brandDark' : 'hover:text-brandDark'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <p className="mt-2 text-xs text-gray-500">{current.description}</p>
    </div>
  );
}

export default StrengthSlider;
