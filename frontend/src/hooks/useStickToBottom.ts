import { useCallback, useLayoutEffect, useRef } from 'react';

const NEAR_BOTTOM_PX = 64;

export function useStickToBottom(active: boolean, contentKey: string) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, []);

  const pinToBottom = useCallback(() => {
    stickRef.current = true;
  }, []);

  useLayoutEffect(() => {
    if (!active) return;
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [active, contentKey]);

  return { listRef, onScroll, pinToBottom };
}
