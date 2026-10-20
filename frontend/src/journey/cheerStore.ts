const autoKey = (today: string) => `journey-cheer-auto:${today}`;
const usedKey = (today: string) => `journey-cheer-used:${today}`;
const countKey = (today: string) => `journey-cheer-count:${today}`;
const starsKey = (today: string) => `journey-stars:${today}`;

export function wasAutoCheerShown(today: string): boolean {
  return localStorage.getItem(autoKey(today)) === '1';
}

export function markAutoCheerShown(today: string): void {
  localStorage.setItem(autoKey(today), '1');
}

export function usedCheerRules(today: string): string[] {
  return (localStorage.getItem(usedKey(today)) ?? '').split(',').filter(Boolean);
}

export function blankCheerCount(today: string): number {
  return Number(localStorage.getItem(countKey(today)) || '0');
}

export function rememberCheerRule(today: string, ruleId: string): number {
  const used = new Set(usedCheerRules(today));
  used.add(ruleId);
  localStorage.setItem(usedKey(today), [...used].join(','));
  const count = blankCheerCount(today) + 1;
  localStorage.setItem(countKey(today), String(count));
  return count;
}

export function rememberAutoRule(today: string, ruleId: string): void {
  const used = new Set(usedCheerRules(today));
  used.add(ruleId);
  localStorage.setItem(usedKey(today), [...used].join(','));
}

export function readStoredStars(today: string): number | null {
  const raw = localStorage.getItem(starsKey(today));
  if (raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function writeStoredStars(today: string, stars: number): void {
  localStorage.setItem(starsKey(today), String(stars));
}
