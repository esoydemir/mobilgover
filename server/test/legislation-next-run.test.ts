import { describe, expect, it } from 'vitest';
import { missedScheduledDays, nextScheduledRun } from '../src/services/legislation';

const cfg = { enabled: true, scanHour: 6 } as any;
describe('next planned scan (Europe/Istanbul, UTC+3)', () => {
  it('before the hour: today at 06:00 Istanbul', () => {
    expect(nextScheduledRun(cfg, false, new Date('2026-11-17T22:50:00Z'))).toBe('2026-11-18T03:00:00.000Z'); // 01:50 Istanbul
  });
  it('after today\'s successful scheduled run: tomorrow 06:00', () => {
    expect(nextScheduledRun(cfg, true, new Date('2026-11-18T05:00:00Z'))).toBe('2026-11-19T03:00:00.000Z');
  });
  it('slot passed and not done: due at the next tick (now)', () => {
    const now = new Date('2026-11-18T09:00:00Z');
    expect(nextScheduledRun(cfg, false, now)).toBe(now.toISOString());
  });
  it('scheduler off: no planned run', () => {
    expect(nextScheduledRun({ enabled: false, scanHour: 6 } as any, false)).toBeNull();
  });
  it('days without a successful scheduled run are listed (machine off at 06:00)', () => {
    expect(missedScheduledDays(['2026-11-18', '2026-11-20'], '2026-11-20')).toEqual(['2026-11-19']);
    expect(missedScheduledDays(['2026-11-18'], '2026-11-21')).toEqual(['2026-11-19', '2026-11-20']);
    expect(missedScheduledDays([], '2026-11-21')).toEqual([]);
  });
});
