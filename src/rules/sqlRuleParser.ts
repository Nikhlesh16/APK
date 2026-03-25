import {Rule, WeekDay} from '../types/models';

type ParseOptions = {
  editingRule?: Rule | null;
  fallbackPackageName?: string;
  fallbackAppName?: string;
};

const DAY_MAP: Record<string, WeekDay> = {
  SUN: 0,
  SUNDAY: 0,
  MON: 1,
  MONDAY: 1,
  TUE: 2,
  TUESDAY: 2,
  WED: 3,
  WEDNESDAY: 3,
  THU: 4,
  THURSDAY: 4,
  FRI: 5,
  FRIDAY: 5,
  SAT: 6,
  SATURDAY: 6,
};

function normalizeQuery(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function parseQuotedList(listText: string): string[] {
  const values: string[] = [];
  const matcher = /(['"])(.*?)\1/g;
  let match = matcher.exec(listText);
  while (match) {
    values.push(match[2].trim());
    match = matcher.exec(listText);
  }
  return values;
}

function mapDays(dayValues: string[]): WeekDay[] {
  const mapped = dayValues
    .map(value => DAY_MAP[value.trim().toUpperCase()])
    .filter((value): value is WeekDay => value !== undefined);

  return Array.from(new Set(mapped)).sort((a, b) => a - b) as WeekDay[];
}

function removePredicate(whereClause: string, predicate: RegExp): string {
  let next = whereClause.replace(predicate, ' ');
  next = next.replace(/\s+AND\s+/gi, ' AND ');
  next = next.replace(/^\s*AND\s*/i, ' ');
  next = next.replace(/\s*AND\s*$/i, ' ');
  return next.replace(/\s+/g, ' ').trim();
}

const PHONE_UNLOCK_RULE_PACKAGE = '__PHONE_UNLOCK_CHOICE_MODE__';
const INACTIVITY_RULE_PACKAGE = '__INACTIVITY_RULE__';
const APP_DEPENDENCY_RULE_PACKAGE = '__APP_DEPENDENCY_RULE__';

function assertTime(value: string): string {
  const matcher = /^(\d{2}):(\d{2})$/;
  const match = value.match(matcher);
  if (!match) {
    throw new Error(`Invalid time format: ${value}. Use HH:MM in 24-hour format.`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`Invalid time value: ${value}.`);
  }

  return value;
}

export function buildSqlFromRule(rule: Rule): string {
  const enabledPredicate = ` AND enabled = ${rule.enabled ? 'TRUE' : 'FALSE'}`;

  if (rule.ruleType === 'continuous_usage_rule') {
    const dayNames = rule.days
      .map(day => {
        const entries = Object.entries(DAY_MAP);
        const fullName = entries.find(([key, value]) => value === day && key.length > 3);
        return fullName ? fullName[0] : 'MONDAY';
      })
      .join("', '");

    const timePredicate =
      rule.startTime === '00:00' && rule.endTime === '00:00'
        ? ''
        : ` AND time BETWEEN '${rule.startTime}' AND '${rule.endTime}'`;
    const thresholdPredicate =
      (rule.thresholdMinutes ?? 0) > 0
        ? ` AND threshold_minutes = ${rule.thresholdMinutes}`
        : '';
    const intervalPredicate =
      (rule.intervalMinutes ?? 0) > 0
        ? ` AND interval_minutes = ${rule.intervalMinutes}`
        : '';
    const usagePredicate =
      (rule.dailyLimitMinutes ?? 0) > 0
        ? ` AND usage_minutes >= ${rule.dailyLimitMinutes}`
        : '';
    const pinPredicate = rule.requirePin ? ' AND require_pin = TRUE' : '';

    return (
      `SELECT * FROM apps WHERE rule_type = 'continuous_usage_rule'` +
      ` AND package_name = '${rule.packageName}'` +
      ` AND day_of_week IN ('${dayNames}')` +
      `${timePredicate}${thresholdPredicate}${intervalPredicate}${usagePredicate}${pinPredicate}` +
      ` AND action = '${rule.action ?? 'block_app'}'` +
      `${enabledPredicate};`
    );
  }

  if (rule.ruleType === 'inactivity_rule') {
    return (
      'SELECT * FROM apps WHERE rule_type = \'inactivity_rule\'' +
      ` AND threshold_minutes = ${rule.thresholdMinutes ?? 420}` +
      ` AND interval_minutes = ${rule.intervalMinutes ?? 5}` +
      ` AND alert_type = '${rule.alertType ?? 'notification'}'` +
      ` AND action = '${rule.action ?? 'show_notification'}'` +
      `${enabledPredicate};`
    );
  }

  if (rule.ruleType === 'app_dependency_rule') {
    const restricted = (rule.restrictedPackages ?? []).join("', '");
    return (
      'SELECT * FROM apps WHERE rule_type = \'app_dependency_rule\'' +
      ` AND trigger_app = '${rule.triggerAppPackage ?? ''}'` +
      ` AND restricted_apps IN ('${restricted}')` +
      ` AND action = '${rule.action ?? 'restrict_switching'}'` +
      `${enabledPredicate};`
    );
  }

  if (rule.phoneUnlockChoiceMode) {
    const liveFree = rule.liveFreeOption ?? true;
    return (
      'SELECT * FROM apps WHERE phone_unlock_choice_mode = TRUE' +
      ` AND live_free = ${liveFree ? 'TRUE' : 'FALSE'}` +
      `${enabledPredicate};`
    );
  }

  const dayNames = rule.days
    .map(day => {
      const entries = Object.entries(DAY_MAP);
      const fullName = entries.find(([key, value]) => value === day && key.length > 3);
      return fullName ? fullName[0] : 'MONDAY';
    })
    .join("', '");

  const timePredicate =
    rule.startTime === '00:00' && rule.endTime === '00:00'
      ? ''
      : ` AND time BETWEEN '${rule.startTime}' AND '${rule.endTime}'`;

  const usagePredicate =
    (rule.dailyLimitMinutes ?? 0) > 0
      ? ` AND usage_minutes >= ${rule.dailyLimitMinutes}`
      : '';

  const pinPredicate = rule.requirePin ? ' AND require_pin = TRUE' : '';

  return (
    `SELECT * FROM apps WHERE package_name = '${rule.packageName}'` +
    ` AND day_of_week IN ('${dayNames}')` +
    `${timePredicate}${usagePredicate}${pinPredicate}` +
    `${enabledPredicate};`
  );
}

export function parseSqlToRules(query: string, options: ParseOptions = {}): Rule[] {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    throw new Error('SQL query is empty.');
  }

  const mainMatch = normalized.match(
    /^SELECT\s+.+?\s+FROM\s+apps\s+WHERE\s+(.+?);?$/i,
  );
  if (!mainMatch) {
    throw new Error(
      "Use standard SQL format: SELECT * FROM apps WHERE package_name = 'com.example.app' AND ...;",
    );
  }

  let whereClause = mainMatch[1].trim();

  const packageInMatch = whereClause.match(/\bpackage_name\s+IN\s*\(([^)]+)\)/i);
  const packageEqMatch = whereClause.match(/\bpackage_name\s*=\s*(['"])(.*?)\1/i);
  const appNameEqMatch = whereClause.match(/\bapp_name\s*=\s*(['"])(.*?)\1/i);
  const dayInMatch = whereClause.match(/\bday_of_week\s+IN\s*\(([^)]+)\)/i);
  const timeBetweenMatch = whereClause.match(
    /\btime\s+BETWEEN\s+(['"])(\d{2}:\d{2})\1\s+AND\s+(['"])(\d{2}:\d{2})\3/i,
  );
  const usageMinutesMatch = whereClause.match(/\busage_minutes\s*>=\s*(\d+)/i);
  const pinMatch = whereClause.match(/\brequire_pin\s*=\s*(TRUE|FALSE)/i);
  const enabledMatch = whereClause.match(/\benabled\s*=\s*(TRUE|FALSE)/i);
  const phoneUnlockChoiceModeMatch = whereClause.match(
    /\bphone_unlock_choice_mode\s*=\s*(TRUE|FALSE)/i,
  );
  const liveFreeMatch = whereClause.match(/\blive_free\s*=\s*(TRUE|FALSE)/i);
  const ruleTypeMatch = whereClause.match(/\brule_type\s*=\s*(['"])(.*?)\1/i);
  const triggerAppMatch = whereClause.match(/\btrigger_app\s*=\s*(['"])(.*?)\1/i);
  const restrictedAppsMatch = whereClause.match(/\brestricted_apps\s+IN\s*\(([^)]+)\)/i);
  const thresholdMinutesMatch = whereClause.match(/\bthreshold_minutes\s*=\s*(\d+)/i);
  const intervalMinutesMatch = whereClause.match(/\binterval_minutes\s*=\s*(\d+)/i);
  const actionMatch = whereClause.match(/\baction\s*=\s*(['"])(.*?)\1/i);
  const alertTypeMatch = whereClause.match(/\balert_type\s*=\s*(['"])(.*?)\1/i);

  let parsedRuleType = 'continuous_usage_rule';
  if (ruleTypeMatch) {
    parsedRuleType = ruleTypeMatch[2].trim().toLowerCase();
    whereClause = removePredicate(whereClause, /\brule_type\s*=\s*(['"])(.*?)\1/i);
  }

  let phoneUnlockChoiceMode = false;
  if (phoneUnlockChoiceModeMatch) {
    phoneUnlockChoiceMode = phoneUnlockChoiceModeMatch[1].toUpperCase() === 'TRUE';
    whereClause = removePredicate(
      whereClause,
      /\bphone_unlock_choice_mode\s*=\s*(TRUE|FALSE)/i,
    );
  }

  let liveFreeOption = true;
  if (liveFreeMatch) {
    liveFreeOption = liveFreeMatch[1].toUpperCase() === 'TRUE';
    whereClause = removePredicate(whereClause, /\blive_free\s*=\s*(TRUE|FALSE)/i);
  }

  if (phoneUnlockChoiceMode) {
    let enabled = true;
    if (enabledMatch) {
      enabled = enabledMatch[1].toUpperCase() === 'TRUE';
      whereClause = removePredicate(whereClause, /\benabled\s*=\s*(TRUE|FALSE)/i);
    }

    if (whereClause.trim().length > 0) {
      throw new Error(
        `Unsupported SQL predicate near: "${whereClause}". For phone unlock mode, use phone_unlock_choice_mode, live_free, and enabled.`,
      );
    }

    return [
      {
        id: options.editingRule?.id ?? `${Date.now()}-unlock-choice`,
        packageName: PHONE_UNLOCK_RULE_PACKAGE,
        appName: 'Phone Unlock Choice Mode',
        startTime: '00:00',
        endTime: '00:00',
        days: [0, 1, 2, 3, 4, 5, 6],
        enabled,
        dailyLimitMinutes: 0,
        requirePin: false,
        phoneUnlockChoiceMode: true,
        liveFreeOption,
      },
    ];
  }

  if (parsedRuleType === 'inactivity_rule') {
    const thresholdMinutes = Math.max(1, Number(thresholdMinutesMatch?.[1] ?? 420));
    const intervalMinutes = Math.max(1, Number(intervalMinutesMatch?.[1] ?? 5));
    const action = (actionMatch?.[2] ?? 'show_notification').toLowerCase();
    const alertType = (alertTypeMatch?.[2] ?? 'notification').toLowerCase();

    whereClause = removePredicate(whereClause, /\bthreshold_minutes\s*=\s*(\d+)/i);
    whereClause = removePredicate(whereClause, /\binterval_minutes\s*=\s*(\d+)/i);
    whereClause = removePredicate(whereClause, /\baction\s*=\s*(['"])(.*?)\1/i);
    whereClause = removePredicate(whereClause, /\balert_type\s*=\s*(['"])(.*?)\1/i);

    let enabled = true;
    if (enabledMatch) {
      enabled = enabledMatch[1].toUpperCase() === 'TRUE';
      whereClause = removePredicate(whereClause, /\benabled\s*=\s*(TRUE|FALSE)/i);
    }

    if (whereClause.trim().length > 0) {
      throw new Error(
        `Unsupported SQL predicate near: "${whereClause}" for inactivity_rule.`,
      );
    }

    return [
      {
        id: options.editingRule?.id ?? `${Date.now()}-inactivity`,
        ruleType: 'inactivity_rule',
        action: action === 'vibrate' ? 'vibrate' : 'show_notification',
        packageName: INACTIVITY_RULE_PACKAGE,
        appName: 'Device Inactivity Rule',
        startTime: '00:00',
        endTime: '00:00',
        days: [0, 1, 2, 3, 4, 5, 6],
        enabled,
        thresholdMinutes,
        intervalMinutes,
        alertType:
          alertType === 'sound' || alertType === 'vibration' || alertType === 'notification'
            ? (alertType as 'sound' | 'vibration' | 'notification')
            : 'notification',
        dailyLimitMinutes: 0,
        requirePin: false,
        phoneUnlockChoiceMode: false,
        liveFreeOption: true,
      },
    ];
  }

  if (parsedRuleType === 'continuous_usage_rule') {
    let packageNames: string[] = [];
    if (packageInMatch) {
      packageNames = parseQuotedList(packageInMatch[1]);
      whereClause = removePredicate(whereClause, /\bpackage_name\s+IN\s*\(([^)]+)\)/i);
    } else if (packageEqMatch) {
      packageNames = [packageEqMatch[2].trim()];
      whereClause = removePredicate(whereClause, /\bpackage_name\s*=\s*(['"])(.*?)\1/i);
    }

    if (packageNames.length === 0 && options.fallbackPackageName) {
      packageNames = [options.fallbackPackageName];
    }

    if (packageNames.length === 0) {
      throw new Error(
        "Missing package_name condition. Add package_name = 'com.example.app' or package_name IN (...).",
      );
    }

    packageNames = packageNames.filter(Boolean);
    if (packageNames.length === 0) {
      throw new Error('package_name list is empty.');
    }

    let appName = options.fallbackAppName ?? packageNames[0];
    if (appNameEqMatch) {
      appName = appNameEqMatch[2].trim() || appName;
      whereClause = removePredicate(whereClause, /\bapp_name\s*=\s*(['"])(.*?)\1/i);
    }

    let days: WeekDay[] = [0, 1, 2, 3, 4, 5, 6];
    if (dayInMatch) {
      const parsedDays = mapDays(parseQuotedList(dayInMatch[1]));
      if (parsedDays.length === 0) {
        throw new Error(
          "day_of_week is invalid. Use day names like 'MONDAY', 'TUE', 'SUN'.",
        );
      }
      days = parsedDays;
      whereClause = removePredicate(whereClause, /\bday_of_week\s+IN\s*\(([^)]+)\)/i);
    }

    let startTime = '00:00';
    let endTime = '00:00';
    if (timeBetweenMatch) {
      startTime = assertTime(timeBetweenMatch[2]);
      endTime = assertTime(timeBetweenMatch[4]);
      whereClause = removePredicate(
        whereClause,
        /\btime\s+BETWEEN\s+(['"])(\d{2}:\d{2})\1\s+AND\s+(['"])(\d{2}:\d{2})\3/i,
      );
    }

    let thresholdMinutes = 0;
    if (thresholdMinutesMatch) {
      thresholdMinutes = Math.max(0, Number(thresholdMinutesMatch[1]) || 0);
      whereClause = removePredicate(whereClause, /\bthreshold_minutes\s*=\s*(\d+)/i);
    }

    let intervalMinutes = 0;
    if (intervalMinutesMatch) {
      intervalMinutes = Math.max(0, Number(intervalMinutesMatch[1]) || 0);
      whereClause = removePredicate(whereClause, /\binterval_minutes\s*=\s*(\d+)/i);
    }

    let dailyLimitMinutes = 0;
    if (usageMinutesMatch) {
      dailyLimitMinutes = Math.max(0, Number(usageMinutesMatch[1]) || 0);
      whereClause = removePredicate(whereClause, /\busage_minutes\s*>=\s*(\d+)/i);
    }

    let requirePin = false;
    if (pinMatch) {
      requirePin = pinMatch[1].toUpperCase() === 'TRUE';
      whereClause = removePredicate(whereClause, /\brequire_pin\s*=\s*(TRUE|FALSE)/i);
    }

    let enabled = true;
    if (enabledMatch) {
      enabled = enabledMatch[1].toUpperCase() === 'TRUE';
      whereClause = removePredicate(whereClause, /\benabled\s*=\s*(TRUE|FALSE)/i);
    }

    let action: 'block_app' = 'block_app';
    if (actionMatch) {
      const parsed = actionMatch[2].trim().toLowerCase();
      action = parsed === 'block_app' ? 'block_app' : 'block_app';
      whereClause = removePredicate(whereClause, /\baction\s*=\s*(['"])(.*?)\1/i);
    }

    if (whereClause.trim().length > 0) {
      throw new Error(
        `Unsupported SQL predicate near: "${whereClause}". Supported fields: package_name, app_name, day_of_week, time, threshold_minutes, interval_minutes, usage_minutes, require_pin, enabled, action.`,
      );
    }

    if (options.editingRule && packageNames.length > 1) {
      throw new Error('Edit mode supports one package_name only.');
    }

    const nowId = Date.now();
    return packageNames.map((pkg, index) => ({
      id: options.editingRule?.id ?? `${nowId}-${index}`,
      ruleType: 'continuous_usage_rule',
      action,
      packageName: pkg,
      appName,
      startTime,
      endTime,
      days,
      enabled,
      dailyLimitMinutes,
      thresholdMinutes,
      intervalMinutes,
      requirePin,
      phoneUnlockChoiceMode: false,
      liveFreeOption: true,
    }));
  }

  if (parsedRuleType === 'app_dependency_rule') {
    const triggerAppPackage = triggerAppMatch?.[2]?.trim() ?? '';
    const restrictedPackages = restrictedAppsMatch
      ? parseQuotedList(restrictedAppsMatch[1]).filter(Boolean)
      : [];
    const action = (actionMatch?.[2] ?? 'restrict_switching').toLowerCase();

    whereClause = removePredicate(whereClause, /\btrigger_app\s*=\s*(['"])(.*?)\1/i);
    whereClause = removePredicate(whereClause, /\brestricted_apps\s+IN\s*\(([^)]+)\)/i);
    whereClause = removePredicate(whereClause, /\baction\s*=\s*(['"])(.*?)\1/i);

    let enabled = true;
    if (enabledMatch) {
      enabled = enabledMatch[1].toUpperCase() === 'TRUE';
      whereClause = removePredicate(whereClause, /\benabled\s*=\s*(TRUE|FALSE)/i);
    }

    if (!triggerAppPackage || restrictedPackages.length === 0) {
      throw new Error(
        "app_dependency_rule requires trigger_app and restricted_apps IN (...).",
      );
    }

    if (whereClause.trim().length > 0) {
      throw new Error(
        `Unsupported SQL predicate near: "${whereClause}" for app_dependency_rule.`,
      );
    }

    return [
      {
        id: options.editingRule?.id ?? `${Date.now()}-dependency`,
        ruleType: 'app_dependency_rule',
        action: action === 'restrict_switching' ? 'restrict_switching' : 'restrict_switching',
        packageName: APP_DEPENDENCY_RULE_PACKAGE,
        appName: 'App Dependency Guard',
        triggerAppPackage,
        restrictedPackages,
        startTime: '00:00',
        endTime: '00:00',
        days: [0, 1, 2, 3, 4, 5, 6],
        enabled,
        dailyLimitMinutes: 0,
        requirePin: false,
        phoneUnlockChoiceMode: false,
        liveFreeOption: true,
      },
    ];
  }

  let packageNames: string[] = [];
  if (packageInMatch) {
    packageNames = parseQuotedList(packageInMatch[1]);
    whereClause = removePredicate(whereClause, /\bpackage_name\s+IN\s*\(([^)]+)\)/i);
  } else if (packageEqMatch) {
    packageNames = [packageEqMatch[2].trim()];
    whereClause = removePredicate(whereClause, /\bpackage_name\s*=\s*(['"])(.*?)\1/i);
  }

  if (packageNames.length === 0 && options.fallbackPackageName) {
    packageNames = [options.fallbackPackageName];
  }

  if (packageNames.length === 0) {
    throw new Error(
      "Missing package_name condition. Add package_name = 'com.example.app' or package_name IN (...).",
    );
  }

  packageNames = packageNames.filter(Boolean);
  if (packageNames.length === 0) {
    throw new Error('package_name list is empty.');
  }

  let appName = options.fallbackAppName ?? packageNames[0];
  if (appNameEqMatch) {
    appName = appNameEqMatch[2].trim() || appName;
    whereClause = removePredicate(whereClause, /\bapp_name\s*=\s*(['"])(.*?)\1/i);
  }

  let days: WeekDay[] = [0, 1, 2, 3, 4, 5, 6];
  if (dayInMatch) {
    const parsedDays = mapDays(parseQuotedList(dayInMatch[1]));
    if (parsedDays.length === 0) {
      throw new Error(
        "day_of_week is invalid. Use day names like 'MONDAY', 'TUE', 'SUN'.",
      );
    }
    days = parsedDays;
    whereClause = removePredicate(whereClause, /\bday_of_week\s+IN\s*\(([^)]+)\)/i);
  }

  let startTime = '00:00';
  let endTime = '00:00';
  if (timeBetweenMatch) {
    startTime = assertTime(timeBetweenMatch[2]);
    endTime = assertTime(timeBetweenMatch[4]);
    whereClause = removePredicate(
      whereClause,
      /\btime\s+BETWEEN\s+(['"])(\d{2}:\d{2})\1\s+AND\s+(['"])(\d{2}:\d{2})\3/i,
    );
  }

  let dailyLimitMinutes = 0;
  if (usageMinutesMatch) {
    dailyLimitMinutes = Math.max(0, Number(usageMinutesMatch[1]) || 0);
    whereClause = removePredicate(whereClause, /\busage_minutes\s*>=\s*(\d+)/i);
  }

  let requirePin = false;
  if (pinMatch) {
    requirePin = pinMatch[1].toUpperCase() === 'TRUE';
    whereClause = removePredicate(whereClause, /\brequire_pin\s*=\s*(TRUE|FALSE)/i);
  }

  let enabled = true;
  if (enabledMatch) {
    enabled = enabledMatch[1].toUpperCase() === 'TRUE';
    whereClause = removePredicate(whereClause, /\benabled\s*=\s*(TRUE|FALSE)/i);
  }

  if (whereClause.trim().length > 0) {
    throw new Error(
      `Unsupported SQL predicate near: "${whereClause}". Supported fields: package_name, app_name, day_of_week, time, usage_minutes, require_pin, enabled.`,
    );
  }

  if (options.editingRule && packageNames.length > 1) {
    throw new Error('Edit mode supports one package_name only.');
  }

  const nowId = Date.now();
  return packageNames.map((pkg, index) => ({
    id: options.editingRule?.id ?? `${nowId}-${index}`,
    ruleType: 'continuous_usage_rule',
    action: 'block_app',
    packageName: pkg,
    appName,
    startTime,
    endTime,
    days,
    enabled,
    dailyLimitMinutes,
    requirePin,
    phoneUnlockChoiceMode: false,
    liveFreeOption: true,
  }));
}
