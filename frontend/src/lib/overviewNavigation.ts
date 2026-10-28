export const OVERVIEW_NAVIGATION_EVENT = 'studypilot:open-learning-overview';

export function scrollToLearningOverview() {
  const event = new Event(OVERVIEW_NAVIGATION_EVENT, { cancelable: true });
  if (!window.dispatchEvent(event)) return;
  const target = document.getElementById('learning-overview') ?? document.getElementById('overview-content');
  target?.scrollIntoView({ behavior: 'instant', block: 'start' });
}
