import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue } from 'framer-motion';

import { clampIconPosition, useAssistantStore } from '@/store';
import { startAssistantGreeting } from '@/lib/assistantGreeting';
import ChatCharacter, { type CharacterMode } from './ChatCharacter';
import './FloatingIcon.css';

/** 全身角色的点击区域（px），拖拽和边界钳制使用相同尺寸。 */
const ICON_SIZE = 235;
/** 窄屏时保留的右边界间距。 */
const EDGE_GAP = 24;
/** 默认脚下不留额外间距，贴页面底部。 */
const BOTTOM_GAP = 0;
/** 判定为「拖拽」而非「点击」的位移阈值（px） */
const DRAG_THRESHOLD = 5;
/** resize 重钳去抖延迟（≤500ms，需求 8.5） */
const RESIZE_DEBOUNCE = 200;
const BUBBLE_WIDTH = 130;
const BUBBLE_PATH = 'M 62 121 C 60 101 74 82 94 78 C 112 74 128 82 137 101 C 148 80 167 71 185 74 C 205 75 216 88 215 107 C 232 99 249 106 256 122 C 265 138 257 153 246 160 C 255 172 247 185 231 187 C 219 188 214 184 211 180 C 213 200 231 216 274 221 C 249 226 217 218 200 202 C 192 223 177 238 158 237 C 147 235 140 230 135 218 C 122 245 105 248 94 236 C 86 228 88 213 99 204 C 74 211 53 199 43 181 C 33 162 39 140 62 121 Z';
const BUBBLE_INNER_PATH = 'M 73 118 C 72 95 88 86 102 89 C 118 87 128 96 138 111 C 149 88 171 81 184 83 C 201 85 208 96 208 120 C 227 111 244 118 248 132 C 254 147 244 155 233 159 C 242 171 235 180 221 178 C 211 178 206 172 205 169 C 200 194 216 210 242 216 C 224 214 208 206 198 190 C 188 217 175 224 157 222 C 146 220 140 210 138 204 C 129 221 111 233 102 224 C 95 217 100 204 107 199 C 78 207 58 188 52 173 C 43 153 51 135 73 118 Z';

/** 计算初始右下角位置（左上角坐标） */
function initialPosition() {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0 };
  }
  return {
    x: Math.max(0, Math.min(window.innerWidth * 0.82 - ICON_SIZE / 2, window.innerWidth - ICON_SIZE - EDGE_GAP)),
    y: Math.max(0, window.innerHeight - ICON_SIZE - BOTTOM_GAP),
  };
}

/**
 * FloatingIcon —— 右下角可拖拽的悬浮聊天图标（需求 8.1～8.5、18.4、18.25）
 *
 * - `position: fixed` + `z-index: 9999`，初始中心在视口宽度 82% 处、贴底，不随滚动移动。
 * - 用 framer-motion `drag` + 实时 `onDrag` 钳制到视口内，拖拽结束再钳一次并写回 store（8.3/8.4/18.25）。
 * - `resize` 去抖重钳（≤500ms）把越界图标拉回最近合法位置（8.5）。
 * - 拖拽位移超阈值视为拖拽，抬手不触发打开；否则视为点击 → toggle 窗口（8.6 入口）。
 */
function FloatingIcon({ overviewEntrance = false }: { overviewEntrance?: boolean }) {
  const position = useAssistantStore((s) => s.position);
  const setPosition = useAssistantStore((s) => s.setPosition);
  const clampPosition = useAssistantStore((s) => s.clampPosition);
  const toggleAssistant = useAssistantStore((s) => s.toggleAssistant);
  const open = useAssistantStore((s) => s.open);
  const streaming = useAssistantStore((s) => s.streaming);
  const replyStarted = useAssistantStore((s) => s.replyStarted);
  const [hovered, setHovered] = useState(false);
  const completedReplyCount = useAssistantStore((s) => s.completedReplyCount);
  const [answering, setAnswering] = useState(false);
  const [entering, setEntering] = useState(false);
  const previousCompletedReplyCount = useRef(completedReplyCount);

  // 外层 motion 的实时坐标（左上角），拖拽期间直接驱动 transform。
  const x = useMotionValue(position.x);
  const y = useMotionValue(position.y);
  const entranceTarget = useRef(position);
  const entranceActive = useRef(false);

  // 记录本次指针按下位置，用于区分点击 / 拖拽。
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (overviewEntrance) return startAssistantGreeting();
  }, [overviewEntrance]);

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

  // 每次切入总览都从视口下方跃入；离开时取消未完成的入场。
  useLayoutEffect(() => {
    const savedPosition = useAssistantStore.getState().position;
    const target = clampIconPosition(
      overviewEntrance || (savedPosition.x === 0 && savedPosition.y === 0) ? initialPosition() : savedPosition,
      { width: window.innerWidth, height: window.innerHeight },
      { width: ICON_SIZE, height: ICON_SIZE },
    );
    entranceTarget.current = target;
    x.set(target.x);
    if (overviewEntrance && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
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
        clampPosition(
          { width: window.innerWidth, height: window.innerHeight },
          { width: ICON_SIZE, height: ICON_SIZE },
        );
      }, RESIZE_DEBOUNCE);
    };
    window.addEventListener('resize', onResize);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [clampPosition]);

  const viewport = () => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  });

  return (
    <motion.div
      className="fixed"
      style={{ x, y, top: 0, left: 0, zIndex: 9999, touchAction: 'none' }}
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
      onDragEnd={() => {
        // 拖拽结束再钳一次并写回 store（需求 8.4）
        const clamped = clampIconPosition(
          { x: x.get(), y: y.get() },
          viewport(),
          { width: ICON_SIZE, height: ICON_SIZE },
        );
        x.set(clamped.x);
        y.set(clamped.y);
        setPosition(clamped);
      }}
    >
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
  );
}

export default FloatingIcon;
