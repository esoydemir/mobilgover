/**
 * Recurring task occurrences in a site's own time zone, skipping days the
 * site is closed. Only fixed IANA zones via Intl; no external date library.
 */
export type Recurrence =
  | { freq: 'once'; on: string; at: string }
  | { freq: 'daily'; at: string }
  | { freq: 'weekly'; weekday: number; at: string }
  | { freq: 'monthly'; day: number; at: string };

export type SiteCalendar = { timezone: string; openingDays: number[]; closures: string[] };

export type Occurrence = { periodKey: string; dueAt: Date };

/** UTC instant of a wall-clock time in a time zone (DST-safe for whole-minute offsets). */
export function zonedToUtc(day: string, time: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (t: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(new Date(t)).map(p => [p.type, p.value]),
    );
    const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!);
    return asUtc - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t);
}

/** Calendar day (YYYY-MM-DD) of an instant in a time zone. */
export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const isoWeekday = (day: string) => ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** Days in the month of a YYYY-MM-DD day. */
export const daysInMonth = (day: string) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate();
/** A monthly check on a day the month does not have (31 in April, 30/31 in February) falls on the LAST day of that month. A scheduling choice, not a legal requirement. */
export const monthlyTargetDay = (wanted: number, inMonthOf: string) => Math.min(wanted, daysInMonth(inMonthOf));

/**
 * What happens to a monthly check in each month of a range, in words: the day used, whether the wanted day does not exist in that month,
 * and whether the site is closed that day (then no task is created that month — the same rule the generator applies).
 */
export function monthlyNotes(rec: { day: number }, cal: SiteCalendar, fromDay: string, toDay: string): { month: string; day: string; clamped: boolean; closed: boolean }[] {
  const out: { month: string; day: string; clamped: boolean; closed: boolean }[] = [];
  for (let m = `${fromDay.slice(0, 7)}-01`; m.slice(0, 7) <= toDay.slice(0, 7); m = addDays(`${m.slice(0, 7)}-${String(daysInMonth(m)).padStart(2, '0')}`, 1)) {
    const used = monthlyTargetDay(rec.day, m); const day = `${m.slice(0, 7)}-${String(used).padStart(2, '0')}`;
    if (day < fromDay || day > toDay) continue;
    out.push({ month: m.slice(0, 7), day, clamped: used !== rec.day, closed: !cal.openingDays.includes(isoWeekday(day)) || cal.closures.includes(day) });
  }
  return out;
}

/** Occurrences whose local day falls in [fromDay, toDay], inclusive. */
export function occurrences(rec: Recurrence, cal: SiteCalendar, fromDay: string, toDay: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
    const open = cal.openingDays.includes(isoWeekday(day)) && !cal.closures.includes(day);
    if (!open) continue;
    if (rec.freq === 'once') { if (day === rec.on) out.push({ periodKey: `O:${rec.on}`, dueAt: zonedToUtc(day, rec.at, cal.timezone) }); }
    else if (rec.freq === 'daily') out.push({ periodKey: day, dueAt: zonedToUtc(day, rec.at, cal.timezone) });
    else if (rec.freq === 'weekly' && isoWeekday(day) === rec.weekday) out.push({ periodKey: `W:${day}`, dueAt: zonedToUtc(day, rec.at, cal.timezone) });
    else if (rec.freq === 'monthly' && Number(day.slice(8)) === monthlyTargetDay(rec.day, day)) out.push({ periodKey: `M:${day.slice(0, 7)}`, dueAt: zonedToUtc(day, rec.at, cal.timezone) });
  }
  return out;
}
