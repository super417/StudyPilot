import { useEffect, useRef } from 'react';
import { motion, useMotionValue } from 'framer-motion';
import { MessageCircle } from 'lucide-react';

import { Magnet } from '@/components/motion';
import { clampIconPosition, useAssistantStore } from '@/store';

/** 图标直径（px），与视觉尺寸保持一致（w-14 / h-14 = 56px） */
const ICON_SIZE = 56;
/** 初始距右 / 下边界间距（需求 8.2） */
const EDGE_GAP = 24;
/** 判定为「拖拽」而非「点击」的位移阈值（px） */
const DRAG_THRESHOLD = 5;
/** resize 重钳去抖延迟（≤500ms，需求 8.5） */
const RESIZE_DEBOUNCE = 200;

/** 计算初始右下角位置（左上角坐标） */
function initialPosition() {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0 };
  }
  return {
    x: Math.max(0, window.innerWidth - ICON_SIZE - EDGE_GAP),
    y: Math.max(0, window.innerHeight - ICON_SIZE - EDGE_GAP),
  };
}

/**
 * FloatingIcon —— 右下角可拖拽的悬浮聊天图标（需求 8.1～8.5、18.4、18.25）
 *
 * - `position: fixed` + `z-index: 9999`，初始距右 / 下边界各 24px，不随滚动移动（8.1/8.2）。
 * - 用 framer-motion `drag` + 实时 `onDrag` 钳制到视口内，拖拽结束再钳一次并写回 store（8.3/8.4/18.25）。
 * - `resize` 去抖重钳（≤500ms）把越界图标拉回最近合法位置（8.5）。
 * - 拖拽位移超阈值视为拖拽，抬手不触发打开；否则视为点击 → toggle 窗口（8.6 入口）。
 * - Magnet 仅在「未拖拽」时对内层视觉元素施加磁吸（18.4）；拖拽用外层 motion 的 x/y，二者不冲突。
 */
function FloatingIcon() {
  const position = useAssistantStore((s) => s.position);
  const setPosition = useAssistantStore((s) => s.setPosition);
  const clampPosition = useAssistantStore((s) => s.clampPosition);
  const toggleAssistant = useAssistantStore((s) => s.toggleAssistant);

  // 外层 motion 的实时坐标（左上角），拖拽期间直接驱动 transform。
  const x = useMotionValue(position.x);
  const y = useMotionValue(position.y);

  // 记录本次指针按下位置，用于区分点击 / 拖拽。
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);

  // 首次挂载：若 store 仍是初始 (0,0)，落到右下角初始位置。
  useEffect(() => {
    if (position.x === 0 && position.y === 0) {
      const init = initialPosition();
      setPosition(init);
      x.set(init.x);
      y.set(init.y);
    }
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // store.position 变化（如 resize 重钳、跨组件）时同步到 motion value。
  useEffect(() => {
    x.set(position.x);
    y.set(position.y);
  }, [position.x, position.y, x, y]);

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
      drag
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
      {/* Magnet 磁吸包裹内层视觉元素（需求 18.4）；拖拽由外层承担，互不干扰 */}
      <Magnet strength={3} padding={150}>
        <button
          type="button"
          aria-label="打开学习助手"
          onClick={() => {
            // 拖拽后抬手不触发打开（需求：区分点击与拖拽）
            if (draggingRef.current) {
              draggingRef.current = false;
              return;
            }
            toggleAssistant();
          }}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-[0_8px_28px_rgba(16,185,129,0.45)] transition-shadow hover:shadow-[0_0_24px_rgba(16,185,129,0.6)] active:scale-95"
        >
          <MessageCircle className="h-6 w-6" strokeWidth={2.2} />
        </button>
      </Magnet>
    </motion.div>
  );
}

export default FloatingIcon;
