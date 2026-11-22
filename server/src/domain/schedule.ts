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

/** Occurrences whose local day falls in [fromDay, toDay], inclusive. */
export function occurrences(rec: Recurrence, cal: SiteCalendar, fromDay: string, toDay: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
    const open = cal.openingDays.includes(isoWeekday(day)) && !cal.closures.includes(day);
    if (!open) continue;
    if (rec.freq === 'once') { if (day === rec.on) out.push({ periodKey: `O:${rec.on}`, dueAt: zonedToUtc(day, rec.at, cal.timezone) }); }
    else if (rec.freq === 'daily') out.push({ periodKey: day, dueAt: zonedToUtc(day, rec.at, cal.timezone) });
    else if (rec.freq === 'weekly' && isoWeekday(day) === rec.weekday) out.push({ periodKey: `W:${day}`, dueAt: zonedToUtc(day, rec.at, cal.timezone) });
    else if (rec.freq === 'monthly' && Number(day.slice(8)) === rec.day) out.push({ periodKey: `M:${day.slice(0, 7)}`, dueAt: zonedToUtc(day, rec.at, cal.timezone) });
  }
  return out;
}
