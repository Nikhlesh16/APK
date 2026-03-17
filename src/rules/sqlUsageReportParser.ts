import {UsageSummary} from '../types/models';

function normalize(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}

function parseStringValue(input: string): string {
  const match = input.match(/^(['"])(.*?)\1$/);
  if (!match) {
    throw new Error(`Expected quoted string, got: ${input}`);
  }
  return match[2];
}

function parseNumericValue(input: string): number {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    throw new Error(`Expected numeric value, got: ${input}`);
  }
  return value;
}

function sortRows(
  rows: UsageSummary[],
  field: string,
  direction: 'ASC' | 'DESC',
): UsageSummary[] {
  const factor = direction === 'ASC' ? 1 : -1;

  return rows.sort((a, b) => {
    if (field === 'total_duration' || field === 'total_minutes') {
      return factor * (a.totalDuration - b.totalDuration);
    }

    if (field === 'sessions') {
      return factor * (a.timeline.length - b.timeline.length);
    }

    if (field === 'app_name') {
      return factor * a.appName.localeCompare(b.appName);
    }

    if (field === 'package_name') {
      return factor * a.packageName.localeCompare(b.packageName);
    }

    throw new Error(
      `Unsupported ORDER BY field: ${field}. Use total_duration, total_minutes, sessions, app_name, or package_name.`,
    );
  });
}

function applyPredicate(rows: UsageSummary[], predicate: string): UsageSummary[] {
  const packageEq = predicate.match(/^package_name\s*=\s*(.+)$/i);
  if (packageEq) {
    const value = parseStringValue(packageEq[1].trim());
    return rows.filter(item => item.packageName === value);
  }

  const appEq = predicate.match(/^app_name\s*=\s*(.+)$/i);
  if (appEq) {
    const value = parseStringValue(appEq[1].trim());
    return rows.filter(item => item.appName === value);
  }

  const appLike = predicate.match(/^app_name\s+LIKE\s+(.+)$/i);
  if (appLike) {
    const value = parseStringValue(appLike[1].trim());
    const needle = value.replace(/%/g, '').toLowerCase();
    return rows.filter(item => item.appName.toLowerCase().includes(needle));
  }

  const totalMinutesCmp = predicate.match(/^total_minutes\s*(>=|<=|=|>|<)\s*(\d+(?:\.\d+)?)$/i);
  if (totalMinutesCmp) {
    const operator = totalMinutesCmp[1];
    const value = parseNumericValue(totalMinutesCmp[2]);
    return rows.filter(item => {
      const minutes = item.totalDuration / 60000;
      if (operator === '>=') return minutes >= value;
      if (operator === '<=') return minutes <= value;
      if (operator === '=') return minutes === value;
      if (operator === '>') return minutes > value;
      return minutes < value;
    });
  }

  const sessionsCmp = predicate.match(/^sessions\s*(>=|<=|=|>|<)\s*(\d+)$/i);
  if (sessionsCmp) {
    const operator = sessionsCmp[1];
    const value = parseNumericValue(sessionsCmp[2]);
    return rows.filter(item => {
      const sessions = item.timeline.length;
      if (operator === '>=') return sessions >= value;
      if (operator === '<=') return sessions <= value;
      if (operator === '=') return sessions === value;
      if (operator === '>') return sessions > value;
      return sessions < value;
    });
  }

  throw new Error(
    `Unsupported predicate: ${predicate}. Supported: package_name = '...', app_name = '...', app_name LIKE '%...%', total_minutes/sessions comparisons.`,
  );
}

export function applyUsageReportSqlQuery(
  report: UsageSummary[],
  query: string,
): UsageSummary[] {
  const normalized = normalize(query);
  if (!normalized) {
    return [...report].sort((a, b) => b.totalDuration - a.totalDuration);
  }

  const mainMatch = normalized.match(
    /^SELECT\s+(.+?)\s+FROM\s+usage_report(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+([a-z_]+)(?:\s+(ASC|DESC))?)?(?:\s+LIMIT\s+(\d+))?\s*;?$/i,
  );

  if (!mainMatch) {
    throw new Error(
      "Use SQL like: SELECT * FROM usage_report WHERE total_minutes >= 30 ORDER BY total_duration DESC LIMIT 5;",
    );
  }

  const selected = mainMatch[1].trim();
  if (selected !== '*') {
    throw new Error('Only SELECT * is supported in this version.');
  }

  let rows = [...report];

  const whereClause = mainMatch[2]?.trim();
  if (whereClause) {
    const predicates = whereClause.split(/\s+AND\s+/i).map(item => item.trim());
    for (const predicate of predicates) {
      rows = applyPredicate(rows, predicate);
    }
  }

  const orderField = (mainMatch[3] || 'total_duration').toLowerCase();
  const orderDirection = (mainMatch[4] || 'DESC').toUpperCase() as 'ASC' | 'DESC';
  rows = sortRows(rows, orderField, orderDirection);

  const limitRaw = mainMatch[5];
  if (limitRaw) {
    const limit = Number(limitRaw);
    if (Number.isFinite(limit) && limit >= 0) {
      rows = rows.slice(0, limit);
    }
  }

  return rows;
}
