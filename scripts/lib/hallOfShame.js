import { STATUS } from './classify.js';

export function isHallOfShameCandidate(app) {
  return app.status === STATUS.ABANDONED && app.isCritical === true;
}

export function buildHallOfShame(apps) {
  return apps.filter(isHallOfShameCandidate);
}
