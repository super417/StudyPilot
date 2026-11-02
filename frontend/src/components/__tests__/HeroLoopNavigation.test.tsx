import { afterEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), useEffect: () => {}, useRef: () => ({ current: null }), useState: (value: unknown) => [value, vi.fn()] }));
import StudyPilotHero from '../StudyPilotHero';
afterEach(() => vi.unstubAllGlobals());
it('learning-loop button scrolls to the ring rather than postcards', () => {
  const scrollIntoView = vi.fn();
  const getElementById = vi.fn((id: string) => id === 'study-loop' ? { scrollIntoView } : null);
  vi.stubGlobal('document', { getElementById });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
  const tree = StudyPilotHero({ onNavigate: vi.fn(), overlap: 0 });
  function find(node: unknown): ReactElement<{ onClick: () => void }> | undefined {
    if (!node || typeof node !== 'object') return undefined;
    const el = node as ReactElement<{ className?: string; children?: unknown; onClick: () => void }>;
    if (el.props?.className === 'sp-hero-n1') return el;
    const children = el.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) { const match = find(child); if (match) return match; }
  }
  const button = find(tree);
  expect(button).toBeDefined();
  button!.props.onClick();
  expect(getElementById).toHaveBeenCalledWith('study-loop');
  expect(scrollIntoView).toHaveBeenCalledOnce();
});
