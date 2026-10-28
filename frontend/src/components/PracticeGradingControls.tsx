import { useId } from 'react';
import './PracticeGradingControls.css';

export type GradingMode = 'all' | 'selected' | 'auto';

interface Props {
  mode: GradingMode;
  onMode: (mode: GradingMode) => void;
  disabled: boolean;
  size: string;
  onSize: (size: string) => void;
  validSize: boolean;
  pending: number;
  selected: number;
  failed: number;
  total: number;
  onGrade: () => void;
  onFinish: () => void;
  onRetry: () => void;
}

export default function PracticeGradingControls(props: Props) {
  const group = useId();
  return (
    <section className="practice-grading card mb-4 p-4" aria-label="今日练习判分设置">
      <h3 className="text-sm font-semibold text-brandDark">今日练习 · 判分方式</h3>
      <fieldset disabled={props.disabled} className="mt-3 min-w-0">
        <legend className="sr-only">选择判分方式</legend>
        <div className="radio-input">
          <div className="glass" aria-hidden="true">
            <div className="glass-inner" />
          </div>
          <div className="selector">
            {(
              [
                ['all', '全部判分'],
                ['selected', '勾选判分'],
                ['auto', '每 n 题自动判分'],
              ] as const
            ).map(([mode, label]) => (
              <div className="choice" key={mode}>
                <div>
                  <input
                    className="choice-circle"
                    type="radio"
                    name={group}
                    id={`${group}-${mode}`}
                    checked={props.mode === mode}
                    onChange={() => props.onMode(mode)}
                  />
                  <span className="ball" aria-hidden="true" />
                </div>
                <label className="choice-name" htmlFor={`${group}-${mode}`}>
                  {label}
                </label>
              </div>
            ))}
          </div>
        </div>
        {props.mode === 'auto' ? (
          <div className="mt-4 space-y-2 text-xs text-brandDark">
            <label className="flex items-center gap-2">
              每完成
              <input
                aria-label="自动判分题数"
                type="number"
                min="1"
                step="1"
                value={props.size}
                onChange={(event) => props.onSize(event.target.value)}
                className="w-16 rounded-lg bg-white px-2 py-1 ring-1 ring-brand/30"
              />
              题判分
            </label>
            {!props.validSize ? <p role="alert">请输入大于 0 的整数。</p> : null}
            <p>
              在题卡点击“完成本题”才计数，输入答案不会触发判分。已完成待判：{props.pending} 题。
            </p>
            <p>更换方式或题数会清空待判计数，保留答案。</p>
            <button
              type="button"
              disabled={!props.validSize || !props.pending}
              onClick={props.onFinish}
              className="grading-action"
            >
              结束练习并判分（{props.pending}）
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={props.mode === 'selected' ? !props.selected : !props.total}
            onClick={props.onGrade}
            className="grading-action mt-4"
          >
            {props.mode === 'all' ? '开始全部判分' : `判分所选（${props.selected}）`}
          </button>
        )}
        {props.failed > 0 ? (
          <button type="button" onClick={props.onRetry} className="grading-action mt-2">
            重试失败题（{props.failed}）
          </button>
        ) : null}
      </fieldset>
      <p className="mt-3 text-xs text-gray-500">
        仅处理已作答且未判分或答案已修改的题；空白题不会算错。失败题请手动重试。
      </p>
    </section>
  );
}
