export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type RuleType =
  | 'continuous_usage_rule'
  | 'inactivity_rule'
  | 'app_dependency_rule'
  | 'unlock_choice_rule';

export type RuleAction =
  | 'block_app'
  | 'restrict_switching'
  | 'vibrate'
  | 'show_notification';

export type Rule = {
  id: string;
  ruleType?: RuleType;
  action?: RuleAction;
  packageName: string;
  appName: string;
  triggerAppPackage?: string;
  restrictedPackages?: string[];
  startTime: string;
  endTime: string;
  days: WeekDay[];
  enabled: boolean;
  dailyLimitMinutes?: number;
  thresholdMinutes?: number;
  intervalMinutes?: number;
  alertType?: 'sound' | 'vibration' | 'notification';
  requirePin?: boolean;
  phoneUnlockChoiceMode?: boolean;
  liveFreeOption?: boolean;
};

export type UsageRecord = {
  packageName: string;
  appName: string;
  startTimestamp: number;
  endTimestamp: number;
  duration: number;
};

export type UsageSummary = {
  packageName: string;
  appName: string;
  totalDuration: number;
  timeline: UsageRecord[];
};

export const WEEK_DAYS: {label: string; value: WeekDay}[] = [
  {label: 'Sun', value: 0},
  {label: 'Mon', value: 1},
  {label: 'Tue', value: 2},
  {label: 'Wed', value: 3},
  {label: 'Thu', value: 4},
  {label: 'Fri', value: 5},
  {label: 'Sat', value: 6},
];
