import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { motion, useAnimationControls } from 'framer-motion';
import { Check, Upload as UpIcon } from 'lucide-react';

/* ══ Upload dropzone ══════════════════════════════════════
   A drop box, and files lying beside it. Pick one up and carry
   it into the box: it uploads there — name, a rolling
   percentage, a bar — ticks, and goes back so you can do it
   again.

   ── NO REAL FILES ───────────────────────────────────────
   The demo files are part of the block. Nothing is read from the
   desktop and nothing is sent anywhere; the drag is an ordinary
   pointer drag inside the block, which is also what lets the
   wall's scripted cursor demonstrate it.

   ── THE BOX INHALES, AND SWALLOWS ───────────────────────
   A plain filled box, no edge. A file carried over it is
   answered before it is let go: the box grows with a small
   bounce and the arrow lifts toward the hand. Let go and the
   file is SUCKED in — it accelerates toward the box's middle,
   shrinking and drawing out long as it goes — and the box gives
   a little gulp before the upload appears in it. Let go
   anywhere else and the file springs home.

   ── ONE OF THEM IS TOO BIG ──────────────────────────────
   The limit is fixed at 5 MB and the video is always over it,
   so dropping it shakes the box, says so in red and the file
   springs home. The picture always goes. */

/* ── 移植到 StudyPilot 的改动 ─────────────────────────────
   * **托盘（.upl-tray）改成箭头左右各一枚**：mood.png / demo.mp4 的
     图标、色标、文件名标签、拖拽、吸附、假进度条全部保持原样，只是
     从盒子下面挪到盒子里、夹着箭头排成一行（.upl-line）。
   * 盒子本身仍然接真实文件：从系统拖进来的文件、或者点盒子选的文件，
     走 POST /api/documents，进度条读的是真实上传字节。**两枚演示文件
     拖进盒子跑的是原来那条假进度**（它们不存在，没法真上传），所以
     拖它们能看到完整的原版动效，拖真文件则是真进度。
   * 两枚演示文件是鼠标装饰，`aria-hidden`、不可 Tab 聚焦 —— 它们现在
     长在 `role="button"` 的盒子内部，再套一层可聚焦按钮是无效的 a11y。
     键盘用户走盒子本身（Enter / 空格选文件）。
   * 拖起来时盒子临时 `overflow: visible`（`.upl[data-held]`），否则
     文件图标出不了盒子的圆角裁剪。
   * 除以上几条外，DOM、CSS、动画、拒绝逻辑都保持原样。 */

/* Read once, the way the wheel and the pill nav do. A
   preference, not a live input. */
const stillness = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* 上限仍是 5 MB —— 盒子现在不写这个数了，只在拒绝的那一下说。
   注意后端 document_service.MAX_FILE_BYTES 是 20 MB —— 想放宽只需改这里。 */
const MAX = 5;

/* what it says the second time, and after */
const SNARK = [
  '还是太大，一点没小',
  '再用力也塞不进去',
  '试过压缩了吗？',
  '盒子现在装满借口了',
  '不行。',
];

const TINT: Record<string, string> = {
  PDF: '#B91C1C',
  DOCX: '#1D4ED8',
  TXT: '#047857',
  MD: '#6D28D9',
  /* 两枚演示文件的色标，取自设计稿本身；拖进盒子之后上传行里也是这两个色 */
  PNG: '#249456',
  MP4: '#315FEE',
};

/* 盒子两侧那两枚演示文件。色标取自设计稿本身。 */
type F = { id: string; name: string; ext: string; size: number; tint: string };

const FILES: F[] = [
  { id: 'img', name: 'mood.png', ext: 'PNG', size: 2.4e6, tint: '#249456' },
  { id: 'vid', name: 'demo.mp4', ext: 'MP4', size: 12.6e6, tint: '#315FEE' },
];

const fmt = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const extOf = (name: string) => name.split('.').pop()?.toUpperCase() ?? '';

/* ── the file icon ─────────────────────────────────────────
   After Untitled UI's: a rounded page on a 40 grid with a thin
   grey outline and a folded corner, and the extension on a
   coloured label that sticks out past the page's left edge —
   the colour carries the kind before the word is read. */
function Page({ ext, tint, size = 40 }: { ext: string; tint: string; size?: number }) {
  return (
    <svg className="upl-page" width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path
        className="upl-page-line"
        d="M7.75 4A3.25 3.25 0 0 1 11 .75h16c.121 0 .238.048.323.134l10.793 10.793a.46.46 0 0 1 .134.323v24A3.25 3.25 0 0 1 35 39.25H11A3.25 3.25 0 0 1 7.75 36z"
      />
      <path className="upl-page-line" d="M27 .5V8a4 4 0 0 0 4 4h7.5" />
      <rect width="29" height="16" x="1" y="18" rx="8" fill={tint} />
      {/* 9 units on the 40 grid: the mark is part of the drawing and
          scales with it, so its size lives here, not in the stylesheet */}
      <text x="15.5" y="29.1" textAnchor="middle" fontSize="9" className="upl-page-ext">{ext}</text>
    </svg>
  );
}

function Roll({ value }: { value: number }) {
  const s = String(Math.round(value));
  return (
    <span className="upl-roll" aria-label={`${s}%`}>
      {s.split('').map((d, i) => (
        <span key={s.length - i} className="upl-roll-col">
          <span className="upl-roll-strip" style={{ transform: `translateY(${-Number(d)}em)` }}>
            {"0123456789".split('').map((n) => <span key={n}>{n}</span>)}
          </span>
        </span>
      ))}
      %
    </span>
  );
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'up'; id: string; name: string; ext: string; size: number; p: number }
  | { kind: 'done'; id: string; name: string; ext: string; size: number };

export interface UploadDropzoneProps {
  /** 真正发出去的那一步；onProgress 收到 0..1 */
  onUpload: (file: File, onProgress: (ratio: number) => void) => Promise<{ ok: boolean; message?: string }>;
  /** 圆角，默认 20（原组件同名参数） */
  corner?: number;
  /** 演示文件「上传」得多快，0..100（原组件同名参数，默认 50） */
  speed?: number;
  /** 文件飞回原位的弹簧回弹，0..100（原组件同名参数，默认 40） */
  bounce?: number;
}

export function UploadDropzone({
  onUpload,
  corner = 20,
  speed = 50,
  bounce = 40,
}: UploadDropzoneProps) {
  const still = stillness();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  /* 哪枚演示文件此刻在盒子里（渲染时藏起来，上传完再弹回来） */
  const [inBox, setInBox] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  /* what the box says when it refuses — null while it is not */
  const [refuse, setRefuse] = useState<string | null>(null);
  const tries = useRef(0);
  const cool = useRef(0);
  const [gulp, setGulp] = useState(false);
  const zone = useRef<HTMLDivElement>(null);
  const now = useRef<HTMLSpanElement>(null);
  const tiles = useRef<Record<string, HTMLSpanElement | null>>({});
  const input = useRef<HTMLInputElement>(null);
  const shake = useAnimationControls();
  const raf = useRef(0);
  const timers = useRef<number[]>([]);
  const knobs = useRef({ speed });
  knobs.current = { speed };
  const dragDepth = useRef(0);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      timers.current.forEach(clearTimeout);
      clearTimeout(cool.current);
    },
    [],
  );
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  /* ── the pretend wire ────────────────────────────────────
     两枚演示文件走这条：它们不在磁盘上，所以进度是算出来的。
     速度跟文件大小有关（越大越慢），而且故意不均匀 —— 匀速爬
     会读成一个计时器。 */
  const sendDemo = (f: F) => {
    setInBox(f.id);
    if (still) {
      finishDemo(f);
      return;
    }
    setPhase({ kind: 'up', id: f.id, name: f.name, ext: f.ext, size: f.size, p: 0 });
    let p = 0;
    let prev = 0;
    const secs = (4 - (clamp(knobs.current.speed, 0, 100) / 100) * 3.2) * (0.7 + Math.min(1, f.size / 5e6) * 0.6);
    const tick = (t: number) => {
      const dt = prev ? Math.min(0.05, (t - prev) / 1000) : 0;
      prev = t;
      /* uneven on purpose: a steady climb reads as a timer */
      p = Math.min(1, p + (dt / secs) * (0.4 + Math.random() * 1.2));
      if (p >= 1) {
        raf.current = 0;
        finishDemo(f);
        return;
      }
      setPhase({ kind: 'up', id: f.id, name: f.name, ext: f.ext, size: f.size, p });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const finishDemo = (f: F) => {
    tries.current = 0;
    setPhase({ kind: 'done', id: f.id, name: f.name, ext: f.ext, size: f.size });
    /* the file goes back to where it came from, ready to go again */
    later(() => {
      setPhase({ kind: 'idle' });
      setInBox(null);
    }, 1500);
  };

  /* ── the real wire ───────────────────────────────────────
     系统拖进来 / 点盒子选的文件走这条，进度是 XHR 推上来的真字节。 */
  const startReal = (file: File) => {
    const ext = extOf(file.name);
    setPhase({ kind: 'up', id: 'real', name: file.name, ext, size: file.size, p: 0 });
    void finishReal(file, ext);
  };

  const finishReal = async (file: File, ext: string) => {
    try {
      const res = await onUpload(file, (ratio) =>
        setPhase((prev) => (prev.kind === 'up' ? { ...prev, p: ratio } : prev)),
      );
      if (!res.ok) {
        setPhase({ kind: 'idle' });
        if (res.message) setRefuse(res.message);
        shake.start({ x: [0, -7, 6, -4, 2, 0], transition: { duration: 0.42 } });
        later(() => setRefuse(null), 1800);
        return;
      }
      tries.current = 0;
      setPhase({ kind: 'done', id: 'real', name: file.name, ext, size: file.size });
      later(() => setPhase({ kind: 'idle' }), 1500);
    } catch {
      setPhase({ kind: 'idle' });
    }
  };

  /* ── trying again ─────────────────────────────────────────
     The first refusal is plain. Try the same thing again and the
     box starts to answer back, a new line each time, the last one
     repeating — until something that fits goes through, which puts
     it back to being polite. */
  const refuseIt = (reason: string) => {
    const n = tries.current++;
    setRefuse(n === 0 ? reason : SNARK[Math.min(n - 1, SNARK.length - 1)]);
    shake.start({ x: [0, -7, 6, -4, 2, 0], transition: { duration: 0.42 } });
    later(() => setRefuse(null), 1800);
    /* "in a row" means close together: leave it alone a while and
       the next refusal is the polite one again */
    clearTimeout(cool.current);
    cool.current = window.setTimeout(() => {
      tries.current = 0;
    }, 8000);
  };

  const accept = (file: File) => {
    if (!['PDF', 'DOCX', 'TXT', 'MD'].includes(extOf(file.name))) {
      refuseIt('仅支持 PDF / DOCX / TXT / Markdown');
      return;
    }
    if (file.size > MAX * 1e6) {
      refuseIt(`太大了，最大 ${MAX} MB`);
      return;
    }
    startReal(file);
  };

  /* ── carrying a file ───────────────────────────────────── */
  const drag = useRef<null | { id: string; x0: number; y0: number; k: number; moved: boolean }>(null);

  const place = (id: string, dx: number, dy: number, lift: boolean) => {
    const el = tiles.current[id];
    if (!el) return;
    /* [data-held] 上是 transition:none（拖的时候要 1:1 跟手），松手这
       一帧 React 还没重渲染、属性还在 —— 手动摘掉，否则「弹回原位」
       会变成瞬间归位。 */
    if (!lift) el.removeAttribute('data-held');
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${lift ? 1.08 : 1}) rotate(${lift ? clamp(dx * 0.04, -6, 6) : 0}deg)`;
  };

  const hits = (e: ReactPointerEvent) => {
    const r = zone.current?.getBoundingClientRect();
    return !!r && e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
  };

  const onDown = (f: F) => (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (inBox === f.id) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* a scripted pointer */
    }
    const k = e.currentTarget.getBoundingClientRect().width / e.currentTarget.offsetWidth || 1;
    drag.current = { id: f.id, x0: e.clientX, y0: e.clientY, k, moved: false };
    setHeld(f.id);
    place(f.id, 0, 0, true);
  };

  const onMove = (e: ReactPointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const dx = (e.clientX - g.x0) / g.k;
    const dy = (e.clientY - g.y0) / g.k;
    if (!g.moved && Math.hypot(dx, dy) > 3) g.moved = true;
    place(g.id, dx, dy, true);
    const on = hits(e) && phase.kind === 'idle';
    if (on !== over) {
      setOver(on);
    }
  };

  const onUp = (f: F) => (e: ReactPointerEvent<HTMLSpanElement>) => {
    const g = drag.current;
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* never captured */
    }
    setHeld(null);
    setOver(false);
    if (!g) return;
    /* 只是点了一下没拖：原版里文件本来就在盒子外面，所以不会命中；
       这里它本来就长在盒子里面，得靠「真的移动过」区分点按与拖放。 */
    const inside = g.moved && hits(e) && phase.kind === 'idle';
    if (inside) {
      if (f.size > MAX * 1e6) refuseIt(`太大了，最大 ${MAX} MB`);
      else {
        suck(f, (e.clientX - g.x0) / g.k, (e.clientY - g.y0) / g.k, g.k);
        return;
      }
    }
    /* springs home */
    place(f.id, 0, 0, false);
  };

  /* ── the suction ──────────────────────────────────────────
     From where it was let go to the box's middle, on an ease-IN:
     slow to leave and faster the nearer it gets, which is what
     reads as being pulled rather than as flying. It shrinks as it
     goes and draws out long in the direction of travel, then the
     box gulps and the upload takes its place. */
  const suck = (f: F, dx: number, dy: number, k: number) => {
    const el = tiles.current[f.id];
    const z = zone.current;
    if (!el || !z || still) {
      place(f.id, 0, 0, false);
      sendDemo(f);
      return;
    }
    const a = el.getBoundingClientRect();
    const b = z.getBoundingClientRect();
    const tx = dx + (b.left + b.width / 2 - (a.left + a.width / 2)) / k;
    const ty = dy + (b.top + b.height / 2 - (a.top + a.height / 2)) / k;
    /* drawn out along the pull, never turned: a tile rotated to
       face its travel went upside down on the way up and spun on
       a short pull. Up or down it goes tall, sideways it goes
       wide, and a pull too short to have a direction only shrinks */
    const ux = Math.abs(tx - dx);
    const uy = Math.abs(ty - dy);
    const squeeze =
      Math.hypot(ux, uy) < 24 ? 'scale(0.16)' : uy >= ux ? 'scale(0.14, 0.34)' : 'scale(0.34, 0.14)';
    el.style.transition = 'transform 380ms cubic-bezier(0.55, 0, 0.85, 0.3), opacity 300ms ease-in 80ms';
    el.style.transform = `translate(${tx}px, ${ty}px) ${squeeze}`;
    el.style.opacity = '0';
    /* the upload starts as the tile goes down the hole, not after
       it has finished vanishing: waiting out the whole pull left a
       beat where the box sat empty, reading as a freeze */
    later(() => {
      setGulp(true);
      later(() => setGulp(false), 460);
    }, 200);
    later(() => sendDemo(f), 220);
    later(() => {
      /* put the tile home unseen, ready to pop back later */
      el.style.transition = 'none';
      el.style.transform = '';
      el.style.opacity = '';
    }, 390);
  };

  /* ── real files, from the desktop ───────────────────────── */
  const hasFiles = (e: ReactDragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const onDragEnter = (e: ReactDragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setOver(true);
  };
  const onDragOver = (e: ReactDragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: ReactDragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setOver(false);
  };
  const onDrop = (e: ReactDragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setOver(false);
    if (phase.kind !== 'idle') return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (file.size <= MAX * 1e6 && ['PDF', 'DOCX', 'TXT', 'MD'].includes(extOf(file.name))) {
      suckReal(file, e.clientX, e.clientY);
      return;
    }
    accept(file);
  };

  /* 真实拖放没有 tile 可起飞，就在落点造一个（.upl-ghost），飞完自己
     移除 —— 观感与演示文件那条一致，DOM 不变。 */
  const suckReal = (file: File, x: number, y: number) => {
    const z = zone.current;
    const ext = extOf(file.name);
    if (!z || still) {
      startReal(file);
      return;
    }
    const b = z.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'upl-ghost';
    ghost.textContent = ext;
    ghost.style.left = `${x}px`;
    ghost.style.top = `${y}px`;
    document.body.appendChild(ghost);
    const tx = b.left + b.width / 2 - x;
    const ty = b.top + b.height / 2 - y;
    const ux = Math.abs(tx);
    const uy = Math.abs(ty);
    const squeeze =
      Math.hypot(ux, uy) < 24 ? 'scale(0.16)' : uy >= ux ? 'scale(0.14, 0.34)' : 'scale(0.34, 0.14)';
    requestAnimationFrame(() => {
      ghost.style.transform = `translate(${tx}px, ${ty}px) ${squeeze}`;
      ghost.style.opacity = '0';
    });
    later(() => {
      setGulp(true);
      later(() => setGulp(false), 460);
    }, 200);
    later(() => startReal(file), 220);
    later(() => ghost.remove(), 420);
  };

  /* ── the box hugs the upload ─────────────────────────────
     While a file is in it the box closes in round the upload row
     — measured, because the row is as wide as its name — and
     grows a little when the tick arrives; back to idle it opens
     out to the full drop box again. Width and height, never a
     scale, so its corner stays the corner. It shrinks inside a
     slot of fixed size, so nothing below it moves. */
  useLayoutEffect(() => {
    const z = zone.current;
    const n = now.current;
    if (!z) return;
    if (phase.kind === 'idle' || !n) {
      z.style.width = '';
      z.style.height = '';
      return;
    }
    z.style.width = `${n.offsetWidth + 32}px`;
    z.style.height = `${n.offsetHeight + 28}px`;
  }, [phase.kind]);

  const r = Math.max(0, corner);
  const up = phase.kind !== 'idle';

  /* 一枚演示文件。样式、拖拽、藏起来都是原托盘的 `.upl-file`，
     只是从盒子下面搬到了箭头两侧。 */
  const tile = (f: F) => (
    <span
      key={f.id}
      ref={(el) => {
        tiles.current[f.id] = el;
      }}
      className="upl-file"
      data-held={held === f.id || undefined}
      data-gone={inBox === f.id || undefined}
      aria-hidden="true"
      onPointerDown={onDown(f)}
      onPointerMove={onMove}
      onPointerUp={onUp(f)}
      onPointerCancel={onUp(f)}
    >
      <Page ext={f.ext} tint={f.tint} />
      <span className="upl-label">{f.name}</span>
    </span>
  );

  return (
    <div
      className="upl"
      data-held={held ? true : undefined}
      style={{ '--upl-r': `${r}px`, '--upl-spring': `cubic-bezier(0.3, ${1 + (bounce / 100) * 0.9}, 0.4, 1)` } as CSSProperties}
    >
      <input
        ref={input}
        type="file"
        accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) accept(file);
          e.target.value = '';
        }}
      />

      <motion.div animate={shake} className="upl-zone-wrap">
        <div
          ref={zone}
          className="upl-zone"
          data-over={over || undefined}
          data-refuse={refuse ? true : undefined}
          data-busy={up || undefined}
          data-gulp={gulp || undefined}
          aria-live="polite"
          role="button"
          tabIndex={0}
          onClick={(e) => {
            /* 点的是那两枚演示文件：那是拖拽用的，不该打开文件选择框 */
            if ((e.target as Element).closest?.('.upl-file')) return;
            if (phase.kind === 'idle') input.current?.click();
          }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && phase.kind === 'idle') {
              e.preventDefault();
              input.current?.click();
            }
          }}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {phase.kind === 'idle' ? (
            <>
              {/* 原来躺在盒子下面的那排文件，现在夹着箭头：左一枚、右一枚 */}
              <span className="upl-line">
                {tile(FILES[0])}
                <span className="upl-icon"><UpIcon size={18} strokeWidth={2} /></span>
                {tile(FILES[1])}
              </span>
              <span className="upl-say">
                <b>{refuse ?? (over ? '松开以上传' : '将文件拖到这里')}</b>
                <span>docx、ppt、txt、md 等都支持上传</span>
              </span>
            </>
          ) : (
            <span className="upl-now" key={phase.id} ref={now}>
              <Page ext={phase.ext} tint={TINT[phase.ext] ?? '#064E3B'} size={36} />
              <span className="upl-text">
                <span className="upl-name">{phase.name}</span>
                <span className="upl-meta">
                  {fmt(phase.size)} ·{' '}
                  {phase.kind === 'done' ? '已上传' : <Roll value={phase.kind === 'up' ? phase.p * 100 : 0} />}
                </span>
                <span className="upl-track">
                  <span
                    className="upl-bar"
                    style={{ transform: `scaleX(${phase.kind === 'up' ? phase.p : 1})` }}
                  />
                </span>
              </span>
              {/* the tick's room is kept from the start, so the box
                  is its final size before the tick arrives */}
              <span className="upl-end">
                {phase.kind === 'done' && <span className="upl-tick"><Check size={14} strokeWidth={2} /></span>}
              </span>
            </span>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default UploadDropzone;
