/**
 * Cadence math for habits. The desktop app shells out to the CLI and the MCP
 * server imports from it, so this module is the only place that decides whether
 * a practice is due — nothing recomputes it in TypeScript.
 */

const MS_PER_DAY = 86_400_000;

/** Fewer gaps than this and an observed cadence is noise rather than a rhythm. */
const MIN_GAPS_FOR_OBSERVED_INTERVAL = 2;

export function daysBetweenDates(fromDate, toDate) {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / MS_PER_DAY);
}

export function shiftDateBy(date, deltaDays) {
  const base = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(base)) return null;
  return new Date(base + deltaDays * MS_PER_DAY).toISOString().slice(0, 10);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function normalizeEntryDates(entries) {
  const dates = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const date = typeof entry === 'string' ? entry : String(entry?.date ?? '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates.add(date);
  }
  return Array.from(dates).sort();
}

export function normalizeTargetIntervalDays(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : null;
}

/**
 * Consistency for one habit as of `asOfDate`. Entries after that date are
 * ignored, so opening an old daily note reports what was true then rather than
 * what is true now.
 */
export function computeHabitStats(habit, entries, asOfDate) {
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(String(asOfDate ?? ''))
    ? String(asOfDate)
    : new Date().toISOString().slice(0, 10);

  const allDates = normalizeEntryDates(entries);
  const dates = allDates.filter((date) => date <= asOf);

  const gaps = [];
  for (let i = 1; i < dates.length; i += 1) {
    const gap = daysBetweenDates(dates[i - 1], dates[i]);
    if (gap !== null) gaps.push(gap);
  }

  const lastDate = dates.length > 0 ? dates[dates.length - 1] : null;
  const daysSinceLast = lastDate ? daysBetweenDates(lastDate, asOf) : null;
  const medianGapDays = gaps.length > 0 ? median(gaps) : null;
  const averageGapDays = gaps.length > 0
    ? Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length)
    : null;

  const targetIntervalDays = normalizeTargetIntervalDays(habit?.targetIntervalDays);
  const observedIntervalDays = gaps.length >= MIN_GAPS_FOR_OBSERVED_INTERVAL ? medianGapDays : null;
  const intervalDays = targetIntervalDays ?? observedIntervalDays;
  const intervalSource = targetIntervalDays ? 'target' : (observedIntervalDays ? 'observed' : null);

  const dueOn = lastDate && intervalDays ? shiftDateBy(lastDate, intervalDays) : null;
  const loggedOnAsOfDate = dates.includes(asOf);

  let state;
  let daysUntilDue = null;
  let daysOverdue = null;
  if (loggedOnAsOfDate) {
    state = 'logged';
  } else if (!dueOn) {
    // Either never practised, or too little history to say anything honest.
    state = 'untracked';
  } else if (asOf < dueOn) {
    state = 'on-track';
    daysUntilDue = daysBetweenDates(asOf, dueOn);
  } else if (asOf === dueOn) {
    state = 'due';
    daysUntilDue = 0;
  } else {
    state = 'overdue';
    daysOverdue = daysBetweenDates(dueOn, asOf);
  }

  return {
    asOfDate: asOf,
    entryCount: dates.length,
    totalEntryCount: allDates.length,
    firstDate: dates.length > 0 ? dates[0] : null,
    lastDate,
    daysSinceLast,
    gaps,
    medianGapDays,
    averageGapDays,
    targetIntervalDays,
    observedIntervalDays,
    intervalDays: intervalDays ?? null,
    intervalSource,
    dueOn,
    state,
    daysUntilDue,
    daysOverdue,
  };
}

/** True when a habit warrants the user's attention on `asOfDate`. */
export function isHabitDue(stats) {
  return stats?.state === 'due' || stats?.state === 'overdue';
}
