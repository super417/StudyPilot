import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { animate, motion, useMotionValue } from 'framer-motion';

/* ══ Stacked bars ═════════════════════════════════════════
   An alert-volume card: a stack of four sources for every day (or
   week), and under the baseline the few that were escalated.

   ── RUN ALONG IT ────────────────────────────────────────
   The column under the pointer gets a ring round its whole stack,
   the rest step back (their colour mixed toward the slab, never
   faded), and one tooltip glides beside it on a spring with the
   date, the total and what made it up.

   ── DAY / WEEK ──────────────────────────────────────────
   Swaps the dataset; every segment eases to its new height and
   offset a beat after its left neighbour. The same transition
   grows the bars out of the baseline the first time the card is
   seen.

   ── 移植到 StudyPilot 的改动 ─────────────────────────────
   * 数据改由 props 传入（本项目的「近 30 日作答量」是真实后端数据，
     不再用 mulberry 造数）。
   * 宽度改为跟随容器（ResizeObserver 量绘图区），原版是固定 300px。
   * Day / Week 开关**保留了**（样式原样），内容换成项目里拿得到的维度：
     「按天 / 按周」—— 后端只给按天的量，周的量在这里按 7 天一组从末尾
     往回合，不用另开接口。开关从原版的标题行挪到数字右边（标题归外层卡片）。
   * 标题由外层卡片提供（统计页每张面板共用同一个标题栏），
     组件只负责数字、图、轴。
   * **0 值也是一根圆柱**：不是圆点、不是 2px 扁条，而是一颗圆角方糖
     （minH = 柱宽 34%，夹在 4–10px），基线上下都算。30 天里没作答的日子
     照样在图上占一格，一根不少。
   * 段间距 / 段圆角都按柱宽算（gap ≈ 18%、r ≈ 30%）：柱子窄的时候自动收成
     胶囊，宽的时候仍然是四角很圆的圆柱 —— 参考图就是这个比例。
   * 轴线不写日期，写「N 天前 / 今天」（周视图写「N 周前 / 本周」），
     浮层里再补一句精确的相对天数。 */

const CH = 104; // room above the baseline
const CH_MAX = 168; // 展开成整行宽时的上限
const BH = 34; // room below it for the escalated bars
const LIFT = 2; // air between the baseline and the bars either side of it
const TIP_W = 132;
const SPRING = { type: 'spring' as const, stiffness: 380, damping: 34 };
/** 首次测量前的兜底宽度，免得首帧算出负的柱宽 */
const FALLBACK_CW = 268;

export type StackedSegment = { label: string; value: number };

export type StackedBar = {
  /** 浮层里那行完整标签 */
  label: string;
  /** 轴上的短标签 */
  short: string;
  /** ISO 日期（YYYY-MM-DD），用来算「距今天数」。缺省时轴退回日期。 */
  date?: string;
  /** 堆叠段，自下而上 */
  segs: StackedSegment[];
  /** 基线下方那根小柱（原版是「被升级的少数」） */
  esc: number;
};

const fmt = (v: number) => Math.round(v).toLocaleString('zh-CN');
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

/** 某天离今天几天：用本地零点相减，避免时区把天数带偏一天。 */
function daysBehind(date?: string): number | null {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return null;
  const then = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - then.getTime()) / 86_400_000);
  return Number.isFinite(diff) ? Math.max(0, diff) : null;
}

/** 浮层里那句「· 3 天前」；当天写「今天」，别写成「0 天前」。 */
function agoText(date?: string): string {
  const d = daysBehind(date);
  if (d === null) return '';
  return d === 0 ? '今天' : `${d} 天前`;
}

/** 按周看：把按天的柱子按 7 天一组从末尾往回并，最后剩下的不足一周也单独成柱。
 *  这是原版 Day / Week 那个开关在本项目里的对应物 —— 后端只有按天的量，
 *  周的量在这里合出来，不用另开接口。 */
function weekly(bars: StackedBar[]): StackedBar[] {
  const out: StackedBar[] = [];
  for (let end = bars.length; end > 0; end -= 7) {
    const chunk = bars.slice(Math.max(0, end - 7), end);
    out.unshift({
      label: `${chunk[0].label} – ${chunk[chunk.length - 1].label}`,
      short: chunk[0].short,
      /* 这一个桶代表到「最后一天」为止的那一周，距今天数按最后一天算 */
      date: chunk[chunk.length - 1].date,
      segs: chunk[0].segs.map((s, k) => ({
        label: s.label,
        value: chunk.reduce((acc, b) => acc + (b.segs[k]?.value ?? 0), 0),
      })),
      esc: chunk.reduce((acc, b) => acc + b.esc, 0),
    });
  }
  return out;
}

export function StackedBars({
  bars,
  unit = '',
  escLabel = 'Escalated',
  colour = 'Colour',
  gap = 6,
}: {
  bars: StackedBar[];
  unit?: string;
  escLabel?: string;
  colour?: 'Mono' | 'Colour';
  gap?: number;
}) {
  const [mode, setMode] = useState<'day' | 'week'>('day');
  /* 原版的 Day / Week 开关留着，换成项目里能拿到的维度：同一批按天的数据，
     按天看还是按周看。 */
  const shown = useMemo(() => (mode === 'week' ? weekly(bars) : bars), [bars, mode]);
  const n = shown.length;
  const [at, setAt] = useState<number | null>(null);
  const [seen, setSeen] = useState(false);
  const [cw, setCw] = useState(0);
  const root = useRef<HTMLDivElement | null>(null);
  const plot = useRef<HTMLDivElement | null>(null);

  /* grow in once, the first time the card is on screen */
  useEffect(() => {
    const el = root.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  /* 原版把宽度写死成 300，这里量绘图区。量 plot 而不是 root：
     plot 的 width 就是 100%，拿到的是去掉内边距后的可用宽度。 */
  useEffect(() => {
    const el = plot.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setCw(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* geometry: the gap gives way before a bar gets thinner than 3px,
     so 30 bars at the widest gap still draw */
  const plotW = cw || FALLBACK_CW;
  /* 原版宽度写死 300，104 高的图在那种宽度下比例是对的。统计卡展开成整行后
     绘图区能到 1100px，柱子会变成 33×104 的矮胖块，所以高度跟着宽度长一点，
     但封顶 CH_MAX，别把两列网格那种窄卡也一起拉高。 */
  const ch = Math.round(Math.max(CH, Math.min(CH_MAX, plotW * 0.26)));
  const segCount = Math.max(1, ...shown.map((b) => b.segs.length));
  /* 30 天时柱子按「一格 width/n 减去缝」算，刚好排满；
     只有几根周柱时柱子封顶 46px，省下来的宽度转给缝（上限 28px），
     整排居中 —— 否则 5 根 190px 的大色块会把图撑成一排方块。 */
  const slot = plotW / Math.max(1, n);
  const bw = Math.max(1, Math.min(46, slot - gap));
  const g = n > 1 ? Math.max(1, Math.min(28, (plotW - bw * n) / (n - 1))) : 0;
  const rowW = bw * n + g * Math.max(n - 1, 0);
  const x0 = Math.max(0, (plotW - rowW) / 2);
  /* 参考图里每一段都是「四角很圆的圆柱」：小柱子（12px 宽）圆角占到四成，
     大柱子封在 11px，别让周视图那几根粗柱被圆成一排药丸。 */
  const r = Math.min(11, Math.max(3, bw * 0.4));
  /* 段与段之间留一条实打实的缝，柱子越宽缝越明显（参考图约柱宽 15–20%） */
  const segGap = Math.max(2, Math.min(6, bw * 0.18));
  /* 数量为 0 的段也要画出来，而且不能是「扁扁的一条」：
     高度按柱宽的 78% 走（夹在 4–12px），画出来是一颗方糖，
     比「1 条数据」矮一档，读得出区别，四角照样是圆的。 */
  const minH = Math.max(4, Math.min(12, bw * 0.78));
  /* 环与柱子的间隙：参考图那圈灰环比柱子每边宽出 4px */
  const ringPad = 4;

  const { layout, totals } = useMemo(() => {
    const stackTops = shown.map((b) => sum(b.segs.map((s) => s.value)));
    const tops = shown.map((b, i) => stackTops[i] + b.esc);
    const tallest = Math.max(1, ...stackTops);
    const tallestEsc = Math.max(1, ...shown.map((b) => b.esc));
    const k = (ch - LIFT - 2 - segGap * (segCount - 1)) / tallest;
    return {
      totals: tops,
      layout: shown.map((b, i) => {
        let y = 0;
        const segs = b.segs.map((s) => {
          /* 每段至少 minH：0 值那天照样有一个圆角块占位，图表里看得见这一天 */
          const h = Math.max(minH, s.value * k);
          const box = { bottom: y, h, zero: s.value === 0 };
          y += h + segGap;
          return box;
        });
        return {
          segs,
          /* 整列一条数据都没有（三段全 0、错题也 0）：只画一根灰方块，
             别把三颗 0 值方糖叠成一根假柱子。 */
          allZero: stackTops[i] === 0 && b.esc === 0,
          top: Math.max(0, y - segGap),
          /* 基线下面那根同样是「有 0 也要有」：最矮就是一颗方糖 */
          esc: Math.max(minH, (b.esc / tallestEsc) * (BH - LIFT - 6)),
          escZero: b.esc === 0,
        };
      }),
    };
  }, [shown, segCount, ch, segGap, minH]);

  /* the headline pops in on a change, Price flow's way: every
     character is keyed by a generation, so a new total is new
     elements and each plays one short entrance, left to right.
     The first paint does not play it; only a change does. */
  const total = sum(totals);
  const [gen, setGen] = useState(0);
  const last = useRef(total);
  useEffect(() => {
    if (last.current === total) return;
    last.current = total;
    setGen((v) => v + 1);
  }, [total]);

  /* ring and tooltip: placed at once when they appear, glide after */
  const ringX = useMotionValue(0);
  const ringY = useMotionValue(0);
  const ringH = useMotionValue(0);
  const tipX = useMotionValue(0);
  const was = useRef<number | null>(null);
  useEffect(() => {
    if (at === null || at >= n) {
      was.current = null;
      return;
    }
    const L = layout[at];
    const left = x0 + at * (bw + g);
    const x = left - ringPad;
    const up = seen ? L.top : 0;
    const down = seen ? L.esc : 0;
    const y = ch - LIFT - up - ringPad;
    const h = up + LIFT + 1 + LIFT + down + ringPad * 2;
    /* beside the column: right while it fits there, else left */
    const right = left + bw + 8;
    const tx =
      right + TIP_W <= plotW || left - 8 - TIP_W < 0
        ? Math.min(plotW - TIP_W, right)
        : left - 8 - TIP_W;
    const go = (mv: typeof ringX, v: number) => {
      if (was.current === null) mv.set(v);
      else animate(mv, v, SPRING);
    };
    go(ringX, x);
    go(ringY, y);
    go(ringH, h);
    go(tipX, tx);
    was.current = at;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, n, bw, g, seen, plotW, ch]);

  const pick = (e: ReactPointerEvent<HTMLDivElement>) => {
    const b = plot.current?.getBoundingClientRect();
    if (!b || b.width === 0) return;
    /* 整排可能居中留了白边，先减掉左边距再按「一根柱 + 一条缝」取整 */
    const rel = e.clientX - b.left - x0;
    const i = Math.floor(rel / Math.max(1, bw + g));
    setAt(Math.max(0, Math.min(n - 1, i)));
  };

  if (n === 0) return null;

  const cur = at !== null && at < n ? shown[at] : null;
  const rows = cur
    ? cur.segs
        .map((s, k) => ({ ...s, k }))
        .sort((a, b) => b.value - a.value)
    : [];

  return (
    <div
      ref={root}
      className="stb"
      data-colour={colour === 'Colour' ? 'on' : 'off'}
      data-scrub={cur ? '' : undefined}
      style={
        {
          ['--stb-r' as string]: `${r}px`,
          /* 环是胶囊形：圆角直接取「环宽的一半」，两端正好半圆 */
          ['--stb-rr' as string]: `${(bw + ringPad * 2) / 2}px`,
        } as CSSProperties
      }
    >
      <div className="stb-figure">
        <span className="stb-num" aria-label={fmt(total)}>
          {fmt(total)
            .split('')
            .map((char, i) => (
              <span
                key={`${gen}-${i}`}
                className="stb-digit"
                data-pop={gen > 0 ? '' : undefined}
                style={{ ['--i' as string]: i } as CSSProperties}
                aria-hidden
              >
                {char}
              </span>
            ))}
        </span>
        {unit ? <span className="stb-unit">{unit}</span> : null}
        {/* 原版头部那个 Day / Week 开关，挪到数字右边；内容换成项目里拿得到的
            「按天 / 按周」，样式一个没改。 */}
        <div className="stb-seg-ctl" data-mode={mode === 'week' ? 'Week' : 'Day'} role="tablist">
          <span className="stb-thumb" aria-hidden />
          {(['day', 'week'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              data-on={mode === m || undefined}
              className="stb-tab"
              onClick={() => setMode(m)}
            >
              {m === 'day' ? '天视图' : '周视图'}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={plot}
        className="stb-plot"
        style={{ height: ch + 1 + BH }}
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* scripted */
          }
          pick(e);
        }}
        onPointerMove={pick}
        onPointerUp={(e) => {
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* scripted */
          }
          if (e.pointerType !== 'mouse') setAt(null);
        }}
        onPointerCancel={() => setAt(null)}
        onPointerLeave={() => setAt(null)}
      >
        <span className="stb-base" style={{ top: ch }} />
        {/* key 用下标，按天 ↔ 按周切换时列会被复用，高度才会过渡 */}
        {shown.map((_, i) => (
          <div
            key={i}
            className="stb-col"
            data-on={at === i ? '' : undefined}
            style={{ left: x0 + i * (bw + g), width: bw, ['--i' as string]: i } as CSSProperties}
          >
            {/* 整列一条数据都没有：一根灰方块占位，看得见这一天，也不假装有量 */}
            {layout[i].allZero ? (
              <span
                className="stb-bar"
                data-empty=""
                style={
                  {
                    bottom: BH + 1 + LIFT,
                    height: seen ? minH : 0,
                  } as CSSProperties
                }
              />
            ) : (
              <>
                {/* 每一段都画，包括 0：0 只是矮成一颗方糖，不能从图里消失 */}
                {layout[i].segs.map((s, k) => (
                  <span
                    key={k}
                    className="stb-bar"
                    data-zero={s.zero ? '' : undefined}
                    style={
                      {
                        ['--c' as string]: `var(--stb-c${Math.min(k + 1, 6)})`,
                        bottom: BH + 1 + LIFT + (seen ? s.bottom : 0),
                        height: seen ? s.h : 0,
                      } as CSSProperties
                    }
                  />
                ))}
                <span
                  className="stb-esc"
                  data-zero={layout[i].escZero ? '' : undefined}
                  style={{ top: ch + 1 + LIFT, height: seen ? layout[i].esc : 0 }}
                />
              </>
            )}
          </div>
        ))}

        <motion.span
          className="stb-ring"
          aria-hidden
          style={{ x: ringX, y: ringY, height: ringH, width: bw + ringPad * 2 }}
        />

        <motion.div
          className="stb-tip"
          style={{ x: tipX, width: TIP_W }}
          aria-hidden={!cur}
        >
          {cur && (
            <>
              <div className="stb-tip-head">
                <span>
                  {cur.label}
                  {agoText(cur.date) ? ` · ${agoText(cur.date)}` : ''}
                </span>
                <b>{fmt(totals[at!])}</b>
              </div>
              {rows.map((row) => (
                <div className="stb-tip-row" key={row.label}>
                  <i
                    style={
                      {
                        ['--c' as string]: `var(--stb-c${Math.min(row.k + 1, 6)})`,
                      } as CSSProperties
                    }
                  />
                  <span>{row.label}</span>
                  <b>{fmt(row.value)}</b>
                </div>
              ))}
              {/* 原版这行永远在，哪怕是 0 —— 浮层里也要能看见「这天 0 道」 */}
              <div className="stb-tip-row" data-esc="">
                <i />
                <span>{escLabel}</span>
                <b>{fmt(cur.esc)}</b>
              </div>
            </>
          )}
        </motion.div>
      </div>

      <div className="stb-axis">
        <span>
          {mode === 'week'
            ? `${Math.max(1, Math.ceil((daysBehind(shown[0].date) ?? n * 7) / 7))} 周前`
            : `${Math.max(1, daysBehind(shown[0].date) ?? n - 1)} 天前`}
        </span>
        <span>{mode === 'week' ? '本周' : '今天'}</span>
      </div>
    </div>
  );
}

export default StackedBars;
