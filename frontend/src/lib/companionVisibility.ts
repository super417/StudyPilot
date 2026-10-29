export const COMPANION_PREFERENCE_KEY = 'studypilot.companion.collapsed';
export const COMPANION_ANCHOR_KEY = 'studypilot.companion.anchor';
export interface CompanionAnchor { x: number; y: number }
export interface CompanionViewport { width: number; height: number }

export function readCompanionAnchor(raw: string | null): CompanionAnchor | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value.x === 'number' && typeof value.y === 'number' && Number.isFinite(value.x) && Number.isFinite(value.y) && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1 ? { x: value.x, y: value.y } : null;
  } catch { return null; }
}

/** Normalized avatar bottom-center, shared by the full character and its dock. */
export function companionAnchorFromPosition(position: { x: number; y: number }, size: number, viewport: CompanionViewport): CompanionAnchor {
  return { x: Math.max(0, Math.min(1, (position.x + size / 2) / Math.max(1, viewport.width))), y: Math.max(0, Math.min(1, (position.y + size) / Math.max(1, viewport.height))) };
}

export function companionPositionFromAnchor(anchor: CompanionAnchor, size: number, viewport: CompanionViewport, footer = 0) {
  return { x: Math.max(0, Math.min(Math.max(0, viewport.width - size), anchor.x * viewport.width - size / 2)), y: Math.max(0, Math.min(Math.max(0, viewport.height - size - footer), anchor.y * viewport.height - size)) };
}

export function defaultCompanionAnchor(viewport: CompanionViewport): CompanionAnchor {
  return companionAnchorFromPosition({ x: Math.max(0, viewport.width - 76 - 8), y: Math.max(0, viewport.height - 94 - 12) }, 76, viewport);
}

/** Pointer clicks wait for dblclick; keyboard activation is immediate. */
export function createCompanionClickIntent(single: () => void, double: () => void, delay = 450) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  return {
    cancel,
    click(detail: number, dragged = false) {
      cancel();
      if (dragged) return;
      if (detail === 0) single();
      else if (detail === 1) timer = setTimeout(() => { timer = undefined; single(); }, delay);
    },
    doubleClick(dragged = false) { cancel(); if (!dragged) double(); },
  };
}

/** A missing preference starts compact on small screens. */
export function companionStartsCollapsed(saved: string | null, width: number): boolean {
  return saved === 'true' || (saved !== 'false' && width < 768);
}

export interface CompanionRect { left: number; top: number; right: number; bottom: number }

/** Touching edges are safe; only visible-area overlap requires yielding. */
export function companionOverlaps(a: CompanionRect, b: CompanionRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** DOM updates caused by expanding must not cancel that explicit choice. */
export function companionExpansionProtected(current: boolean, event: 'expand' | 'collapse' | 'mutation' | 'external'): boolean {
  if (event === 'expand') return true;
  if (event === 'collapse' || event === 'external') return false;
  return current;
}

/** Move the small dock above intersecting controls, staying inside the viewport. */
export function companionDockLift(dock: CompanionRect, controls: CompanionRect[]): number {
  let lift = 0;
  for (let step = 0; step < controls.length; step += 1) {
    const candidate = { ...dock, top: dock.top - lift, bottom: dock.bottom - lift };
    const overlaps = controls.filter((control) => companionOverlaps(candidate, control));
    if (!overlaps.length) break;
    const next = Math.max(...overlaps.map((control) => dock.bottom - control.top + 8));
    if (next > dock.top - 8) break;
    lift = next;
  }
  return lift;
}
