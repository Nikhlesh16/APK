import {Rule} from '../types/models';

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) {
    return 0;
  }
  return h * 60 + m;
}

export function isRuleActiveNow(rule: Rule, now = new Date()): boolean {
  if (
    rule.phoneUnlockChoiceMode ||
    rule.ruleType === 'continuous_usage_rule' ||
    rule.ruleType === 'inactivity_rule' ||
    rule.ruleType === 'app_dependency_rule'
  ) {
    // Event/session rules are not time-window locked in the editor.
    return false;
  }

  if (!rule.enabled) {
    return false;
  }

  const currentDay = now.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  if (!rule.days.includes(currentDay)) {
    return false;
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const start = parseTimeToMinutes(rule.startTime);
  const end = parseTimeToMinutes(rule.endTime);

  if (start === end) {
    return true;
  }

  if (start < end) {
    return nowMinutes >= start && nowMinutes < end;
  }

  return nowMinutes >= start || nowMinutes < end;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
