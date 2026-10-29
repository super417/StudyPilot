import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { animate, motion, useMotionValue } from 'framer-motion';

import { clampIconPosition, useAssistantStore } from '@/store';
import { startAssistantGreeting } from '@/lib/assistantGreeting';
import { COMPANION_PREFERENCE_KEY, COMPANION_ANCHOR_KEY, companionAnchorFromPosition, companionPositionFromAnchor, defaultCompanionAnchor, readCompanionAnchor, createCompanionClickIntent, companionDockLift, companionExpansionProtected, companionOverlaps, companionStartsCollapsed } from '@/lib/companionVisibility';
import ChatCharacter, { type CharacterMode } from './ChatCharacter';
import './FloatingIcon.css';

/** 全身角色的点击区域（px），拖拽和边界钳制使用相同尺寸。 */
const ICON_SIZE = 235;
/** 判定为「拖拽」而非「点击」的位移阈值（px） */
const DRAG_THRESHOLD = 5;
/** resize 重钳去抖延迟（≤500ms，需求 8.5） */
const RESIZE_DEBOUNCE = 200;
const BUBBLE_WIDTH = 130;
const BUBBLE_PATH = 'M 62 121 C 60 101 74 82 94 78 C 112 74 128 82 137 101 C 148 80 167 71 185 74 C 205 75 216 88 215 107 C 232 99 249 106 256 122 C 265 138 257 153 246 160 C 255 172 247 185 231 187 C 219 188 214 184 211 180 C 213 200 231 216 274 221 C 249 226 217 218 200 202 C 192 223 177 238 158 237 C 147 235 140 230 135 218 C 122 245 105 248 94 236 C 86 228 88 213 99 204 C 74 211 53 199 43 181 C 33 162 39 140 62 121 Z';
const BUBBLE_INNER_PATH = 'M 73 118 C 72 95 88 86 102 89 C 118 87 128 96 138 111 C 149 88 171 81 184 83 C 201 85 208 96 208 120 C 227 111 244 118 248 132 C 254 147 244 155 233 159 C 242 171 235 180 221 178 C 211 178 206 172 205 169 C 200 194 216 210 242 216 C 224 214 208 206 198 190 C 188 217 175 224 157 222 C 146 220 140 210 138 204 C 129 221 111 233 102 224 C 95 217 100 204 107 199 C 78 207 58 188 52 173 C 43 153 51 135 73 118 Z';

/**
 * FloatingIcon —— 右下角可拖拽的悬浮聊天图标（需求 8.1～8.5、18.4、18.25）
 *
 * - `position: fixed` + `z-index: 9999`，头像和全身共享底部中心锚点；手动位置按视口比例保存。
 * - 用 framer-motion `drag` + 实时 `onDrag` 钳制到视口内，拖拽结束再钳一次并写回 store（8.3/8.4/18.25）。
 * - `resize` 去抖重钳（≤500ms）把越界图标拉回最近合法位置（8.5）。
 * - 拖拽位移超阈值视为拖拽，抬手不触发打开；否则视为点击 → toggle 窗口（8.6 入口）。
 */
function FloatingIcon({ overviewEntrance = false }: { overviewEntrance?: boolean }) {
  const position = useAssistantStore((s) => s.position);
  const setPosition = useAssistantStore((s) => s.setPosition);
  const toggleAssistant = useAssistantStore((s) => s.toggleAssistant);
  const open = useAssistantStore((s) => s.open);
  const streaming = useAssistantStore((s) => s.streaming);
  const replyStarted = useAssistantStore((s) => s.replyStarted);
  const [hovered, setHovered] = useState(false);
  const completedReplyCount = useAssistantStore((s) => s.completedReplyCount);
  const [answering, setAnswering] = useState(false);
  const [entering, setEntering] = useState(false);
  const previousCompletedReplyCount = useRef(completedReplyCount);
  const containerRef = useRef<HTMLDivElement>(null);
  const compactRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const [dockLift, setDockLift] = useState(0);
  const dockLiftRef = useRef(0);
  const expansionProtected = useRef(false);
  const [viewportSize, setViewportSize] = useState(() => ({ width: typeof window === 'undefined' ? 1 : window.innerWidth, height: typeof window === 'undefined' ? 1 : window.innerHeight }));
  const [anchor, setAnchor] = useState(() => {
    try { return readCompanionAnchor(localStorage.getItem(COMPANION_ANCHOR_KEY)) ?? defaultCompanionAnchor(viewportSize); }
    catch { return defaultCompanionAnchor(viewportSize); }
  });
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const dockPosition = companionPositionFromAnchor(anchor, 76, viewportSize, 18);
  const updateAnchor = (point: { x: number; y: number }, size: number, persist: boolean) => {
    const next = companionAnchorFromPosition(point, size, viewport());
    anchorRef.current = next;
    setAnchor(next);
    if (persist) {
      try { localStorage.setItem(COMPANION_ANCHOR_KEY, JSON.stringify(next)); } catch { /* Session position remains usable. */ }
      setPosition(companionPositionFromAnchor(next, ICON_SIZE, viewport()));
    }
  };
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return companionStartsCollapsed(localStorage.getItem(COMPANION_PREFERENCE_KEY), window.innerWidth); }
    catch { return companionStartsCollapsed(null, window.innerWidth); }
  });
  const [yielding, setYielding] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const compact = collapsed || yielding;
  const compactState = useRef(compact);
  compactState.current = compact;
  const setCompactPreference = (value: boolean) => {
    expansionProtected.current = companionExpansionProtected(expansionProtected.current, value ? 'collapse' : 'expand');
    setCollapsed(value);
    setYielding(false);
    setHovered(false);
    try { localStorage.setItem(COMPANION_PREFERENCE_KEY, String(value)); } catch { /* Session controls remain available. */ }
    window.requestAnimationFrame(() => (value ? compactRef : collapseRef).current?.focus({ preventScroll: true }));
  };
  const compactActions = useRef({ single: toggleAssistant, double: () => setCompactPreference(false) });
  compactActions.current = { single: toggleAssistant, double: () => setCompactPreference(false) };
  const clickIntent = useMemo(() => createCompanionClickIntent(() => compactActions.current.single(), () => compactActions.current.double()), []);
  useEffect(() => () => clickIntent.cancel(), [clickIntent]);
  useEffect(() => { if (modalOpen) clickIntent.cancel(); }, [modalOpen, clickIntent]);
  const dockPointer = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);

  // 外层 motion 的实时坐标（左上角），拖拽期间直接驱动 transform。
  const x = useMotionValue(position.x);
  const y = useMotionValue(position.y);
  const entranceTarget = useRef(position);
  const entranceActive = useRef(false);
  const hasEntered = useRef(false);

  // 记录本次指针按下位置，用于区分点击 / 拖拽。
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (overviewEntrance && !compact && !modalOpen) return startAssistantGreeting();
  }, [overviewEntrance, compact, modalOpen]);

  // Yield while the page is being used. Automatic compacting never overwrites
  // the user's saved preference; explicitly expanding stays put until the next
  // page interaction or layout change.
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const visibleModal = [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"][aria-modal="true"]')]
        .some((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
      setModalOpen(visibleModal);
      if (visibleModal || (draggingRef.current && (dockPointer.current !== null || pointerStart.current !== null))) return;
      if (compactState.current && dockRef.current?.getClientRects().length) {
        const dock = dockRef.current.getBoundingClientRect();
        const baseline = { left: dock.left, right: dock.right, top: dock.top + dockLiftRef.current, bottom: dock.bottom + dockLiftRef.current };
        const controls = [...document.querySelectorAll<HTMLElement>('button, a, input, select, textarea, [role="button"]')]
          .filter((element) => !element.closest('[data-assistant-companion]') && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
          .map((element) => element.getBoundingClientRect());
        const lift = companionDockLift(baseline, controls);
        if (lift !== dockLiftRef.current) {
          dockLiftRef.current = lift;
          setDockLift(lift);
        }
      }
      // Opening/using chat must keep the visible doll and its animation alive.
      // Read current state because pointerup schedules this check before click.
      if (compactState.current || expansionProtected.current || useAssistantStore.getState().open) return;
      const bounds = { left: x.get(), top: y.get(), right: x.get() + ICON_SIZE, bottom: y.get() + ICON_SIZE };
      const obstacles = document.querySelectorAll<HTMLElement>('main button, main a, main input, main select, main textarea, main p, main h2, main h3, main li, aside, [data-assistant-panel], .overview-back-to-top:not([hidden])');
      if ([...obstacles].some((element) => {
        if (element.closest('[data-assistant-companion]') || !element.getClientRects().length) return false;
        const style = getComputedStyle(element);
        return style.visibility !== 'hidden' && style.display !== 'none' && companionOverlaps(bounds, element.getBoundingClientRect());
      })) {
        if (containerRef.current?.contains(document.activeElement)) {
          window.requestAnimationFrame(() => compactRef.current?.focus({ preventScroll: true }));
        }
        setYielding(true);
        setHovered(false);
      }
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(check); };
    const onViewportInteraction = () => {
      expansionProtected.current = companionExpansionProtected(expansionProtected.current, 'external');
      schedule();
    };
    const onInteraction = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-assistant-companion]')) onViewportInteraction();
    };
    const observer = new MutationObserver((records) => {
      if (records.some((record) => !(record.target instanceof Element) || !record.target.closest('[data-assistant-companion]'))) schedule();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'aria-modal', 'hidden'] });
    window.addEventListener('scroll', onInteraction, { passive: true, capture: true });
    window.addEventListener('resize', onViewportInteraction, { passive: true });
    document.addEventListener('focusin', onInteraction);
    document.addEventListener('pointerup', onInteraction);
    schedule();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onInteraction, true);
      window.removeEventListener('resize', onViewportInteraction);
      document.removeEventListener('focusin', onInteraction);
      document.removeEventListener('pointerup', onInteraction);
    };
  }, [x, y, overviewEntrance, position.x, position.y]);

  useEffect(() => {
    if (completedReplyCount !== previousCompletedReplyCount.current && open && !streaming) {
      setAnswering(true);
    }
    previousCompletedReplyCount.current = completedReplyCount;
  }, [completedReplyCount, open, streaming]);

  useEffect(() => {
    if (streaming) setAnswering(false);
  }, [streaming]);

  useEffect(() => {
    if (!open) {
      setAnswering(false);
      setHovered(false);
    }
  }, [open]);

  const onAnswerEnd = useCallback(() => setAnswering(false), []);
  const onEntranceEnd = useCallback(() => {
    entranceActive.current = false;
    setPosition(entranceTarget.current);
    setEntering(false);
  }, [setPosition]);
  const mode: CharacterMode = entering ? 'entrance' : !open
    ? hovered ? 'hover' : 'idle'
    : answering ? 'answer'
    : streaming && !replyStarted ? 'thinking'
    : 'open';
  const showBubble = hovered && !open && !entering;
  const bubbleBelow = position.y < 110;
  const bubbleLeft = typeof window === 'undefined'
    ? 11
    : Math.max(12 - position.x, Math.min(11, window.innerWidth - position.x - BUBBLE_WIDTH - 12));

  // 首次总览可入场；后续切换继续使用用户锚点，不重置到默认右下角。
  useLayoutEffect(() => {
    const target = companionPositionFromAnchor(anchorRef.current, ICON_SIZE, { width: window.innerWidth, height: window.innerHeight });
    entranceTarget.current = target;
    x.set(target.x);
    if (overviewEntrance && !compactState.current && !hasEntered.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      hasEntered.current = true;
      entranceActive.current = true;
      y.set(window.innerHeight + 8);
      setHovered(false);
      setEntering(true);
      const controls = animate(y, target.y, {
        type: 'spring',
        stiffness: 110,
        damping: 13,
        mass: 0.9,
      });
      return () => controls.stop();
    }
    entranceActive.current = false;
    setEntering(false);
    setPosition(target);
    y.set(target.y);
  }, [overviewEntrance, setPosition, x, y]);

  // store.position 变化（如 resize 重钳、跨组件）时同步到 motion value。
  useEffect(() => {
    if (entranceActive.current || (position.x === 0 && position.y === 0)) return;
    x.set(position.x);
    y.set(position.y);
  }, [position.x, position.y, x, y, entering]);

  // window.resize 去抖重钳（需求 8.5，≤500ms）。
  useEffect(() => {
    let timer: number | undefined;
    const onResize = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const size = { width: window.innerWidth, height: window.innerHeight };
        setViewportSize(size);
        setPosition(companionPositionFromAnchor(anchorRef.current, ICON_SIZE, size));
      }, RESIZE_DEBOUNCE);
    };
    window.addEventListener('resize', onResize);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [setPosition]);

  const viewport = () => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  });

  return (
    <>
    {compact && !modalOpen && <div ref={dockRef} className="assistant-compact-dock" data-assistant-companion style={{ left: `clamp(env(safe-area-inset-left, 0px), ${dockPosition.x}px, calc(100vw - 76px - env(safe-area-inset-right, 0px)))`, top: `clamp(env(safe-area-inset-top, 0px), ${dockPosition.y - dockLift}px, calc(100dvh - 94px - env(safe-area-inset-bottom, 0px)))`, right: 'auto', bottom: 'auto' }}>
      <button ref={compactRef} type="button" className="assistant-compact-dock__chat" aria-label={open ? '关闭学习助手' : '打开学习助手'} aria-expanded={open}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          clickIntent.cancel();
          draggingRef.current = false;
          const box = dockRef.current!.getBoundingClientRect();
          dockPointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top };
        }}
        onPointerMove={(event) => {
          const start = dockPointer.current;
          if (!start || start.id !== event.pointerId) return;
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= DRAG_THRESHOLD && !draggingRef.current) return;
          draggingRef.current = true;
          clickIntent.cancel();
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = clampIconPosition({ x: start.left + event.clientX - start.x, y: start.top + event.clientY - start.y }, viewport(), { width: 76, height: 94 });
          dockLiftRef.current = 0;
          setDockLift(0);
          updateAnchor(point, 76, false);
        }}
        onPointerUp={(event) => {
          const start = dockPointer.current;
          if (!start || start.id !== event.pointerId) return;
          if (draggingRef.current) {
            event.currentTarget.releasePointerCapture(event.pointerId);
            updateAnchor(companionPositionFromAnchor(anchorRef.current, 76, viewport(), 18), 76, true);
          }
          dockPointer.current = null;
        }}
        onPointerCancel={() => { dockPointer.current = null; draggingRef.current = true; clickIntent.cancel(); }}
        onClick={(event) => {
          clickIntent.click(event.detail, event.detail !== 0 && draggingRef.current);
        }}
        onDoubleClick={(event) => { event.preventDefault(); clickIntent.doubleClick(draggingRef.current); }}
        title={yielding ? '已收起人物以避让页面内容；单击聊天，双击展开，头像可拖动' : '单击聊天，双击展开人物；可拖动头像'}><span className="assistant-compact-dock__portrait" aria-hidden="true"><img src="/assistant/companion-avatar.png" alt="" draggable={false} /></span></button>
      <button type="button" className="assistant-compact-dock__expand" aria-label="展开助手人物" aria-expanded={false} aria-controls="assistant-character" onClick={() => setCompactPreference(false)}>展开</button>
    </div>}
    <motion.div
      ref={containerRef}
      id="assistant-character"
      data-assistant-companion
      aria-hidden={compact || modalOpen}
      className="fixed"
      style={{ x, y, top: 0, left: 0, zIndex: 9999, touchAction: 'none', display: compact || modalOpen ? 'none' : undefined }}
      drag={!entering}
      dragMomentum={false}
      dragElastic={0}
      // 实时约束在视口内（需求 8.3）
      onDrag={() => {
        const clamped = clampIconPosition(
          { x: x.get(), y: y.get() },
          viewport(),
          { width: ICON_SIZE, height: ICON_SIZE },
        );
        x.set(clamped.x);
        y.set(clamped.y);
      }}
      onPointerDown={(e) => {
        pointerStart.current = { x: e.clientX, y: e.clientY };
        draggingRef.current = false;
      }}
      onPointerMove={(e) => {
        const start = pointerStart.current;
        if (!start) return;
        const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
        if (dist > DRAG_THRESHOLD) draggingRef.current = true;
      }}
      onPointerUp={() => { pointerStart.current = null; }}
      onDragEnd={() => {
        // 拖拽结束再钳一次并写回 store（需求 8.4）
        const clamped = clampIconPosition(
          { x: x.get(), y: y.get() },
          viewport(),
          { width: ICON_SIZE, height: ICON_SIZE },
        );
        x.set(clamped.x);
        y.set(clamped.y);
        updateAnchor(clamped, ICON_SIZE, true);
      }}
    >
      <button ref={collapseRef} type="button" className="assistant-character-collapse" aria-label="收起助手人物" aria-expanded={true} aria-controls="assistant-character" onPointerDown={(event) => event.stopPropagation()} onClick={() => setCompactPreference(true)}>收起</button>
      <div
        id="assistant-invite-bubble"
        aria-hidden={!showBubble}
        className={`assistant-glass-bubble ${showBubble ? 'assistant-glass-bubble--visible' : ''} ${bubbleBelow ? 'assistant-glass-bubble--below' : ''}`}
        style={{ left: bubbleLeft, top: bubbleBelow ? ICON_SIZE - 4 : -97 }}
      >
        <span className="assistant-glass-bubble__surface" aria-hidden="true" />
        <svg className="assistant-glass-bubble__art" viewBox="0 0 304 260" aria-hidden="true">
          <defs>
            <clipPath id="assistant-invite-cloud-clip" clipPathUnits="objectBoundingBox">
              <path d={BUBBLE_PATH} transform="scale(0.003289474 0.003846154)" />
            </clipPath>
          </defs>
          <path className="assistant-glass-bubble__shadow" d={BUBBLE_PATH} transform="translate(0 4)" />
          <path className="assistant-glass-bubble__rim" d={BUBBLE_PATH} />
          <path className="assistant-glass-bubble__highlight" d={BUBBLE_PATH} />
          <path className="assistant-glass-bubble__dash" d={BUBBLE_INNER_PATH} />
          <g className="assistant-glass-bubble__sparks">
            <path d="M 41 84 L 53 124 L 31 96 Z" />
            <path d="M 18 128 L 52 130 L 25 149 Z" />
            <path d="M 222 48 L 244 55 L 217 96 Z" />
            <path d="M 252 86 L 257 99 L 221 103 Z" />
            <path d="M 274 137 L 291 151 L 259 164 Z" />
            <path d="M 267 158 L 277 171 L 254 172 Z" />
          </g>
        </svg>
        <span className="assistant-glass-bubble__text">Hi，想要和<br />我聊聊吗？</span>
      </div>
      <button
        type="button"
        aria-label={open ? '关闭学习助手' : '打开学习助手'}
        aria-expanded={open}
        aria-describedby={showBubble ? 'assistant-invite-bubble' : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={() => {
          // 拖拽后抬手不触发打开（需求：区分点击与拖拽）
          if (draggingRef.current) {
            draggingRef.current = false;
            return;
          }
          toggleAssistant();
        }}
        style={{ width: ICON_SIZE, height: ICON_SIZE }}
        className="flex items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <ChatCharacter mode={mode} onAnswerEnd={entering ? onEntranceEnd : onAnswerEnd} />
      </button>
    </motion.div>
    </>
  );
}

export default FloatingIcon;
