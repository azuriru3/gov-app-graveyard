export const STATUS = Object.freeze({
  SHUTDOWN: 'shutdown',
  FRESH: 'active-fresh',
  STALE: 'active-stale',
  ABANDONED: 'active-abandoned',
});

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const FRESH_THRESHOLD_DAYS = 365;
const STALE_THRESHOLD_DAYS = 365 * 3;

export function classifyApp(app, today) {
  if (app.shutdown) {
    return STATUS.SHUTDOWN;
  }
  if (!app.lastUpdated) {
    // No recorded update date at all is treated as the worst case: we can't
    // tell whether the app is fine or simply never reports updates.
    return STATUS.ABANDONED;
  }
  const daysSinceUpdate = (today - new Date(app.lastUpdated)) / MS_PER_DAY;
  if (daysSinceUpdate < FRESH_THRESHOLD_DAYS) {
    return STATUS.FRESH;
  }
  if (daysSinceUpdate < STALE_THRESHOLD_DAYS) {
    return STATUS.STALE;
  }
  return STATUS.ABANDONED;
}
