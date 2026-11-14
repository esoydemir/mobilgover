import type { TaskRow } from '../api/types';
import { addDays, dayKey, startOfDay } from './dates';

/**
 * One definition of "today / late / upcoming / done" and of the window the task lists are read from.
 * The home cards, the risk centre and the task list all use this file, so a number on a card is always the
 * length of the list it opens (same data, same filter).
 */
export type TaskFilter = 'today' | 'late' | 'upcoming' | 'done';
export const TASK_FILTERS: [TaskFilter, string][] = [['today', 'Bugün'], ['late', 'Gecikmiş'], ['upcoming', 'Yaklaşan'], ['done', 'Tamamlanan']];
export const isTaskFilter = (v: unknown): v is TaskFilter => TASK_FILTERS.some(([k]) => k === v);

/** -14 … +15 days around today; the same window for every screen. Without a site: every site the person may see. */
export function taskWindowPath(base: string, siteId: string | null) {
  const today = startOfDay();
  const from = encodeURIComponent(addDays(today, -14).toISOString());
  const to = encodeURIComponent(addDays(today, 15).toISOString());
  return `${base}/tasks?${siteId ? `siteId=${siteId}&` : ''}from=${from}&to=${to}`;
}

export function bucketTasks(rows: TaskRow[], now = new Date()): Record<TaskFilter, TaskRow[]> & { all: TaskRow[] } {
  const today = startOfDay(now);
  const key = dayKey(today);
  const all = rows.filter(t => t.status !== 'cancelled');
  return {
    all,
    today: all.filter(t => dayKey(new Date(t.due_at)) === key),
    late: all.filter(t => (t.status === 'open' || t.status === 'missed') && new Date(t.due_at) < now),
    upcoming: all.filter(t => t.status === 'open' && new Date(t.due_at) >= addDays(today, 1)),
    done: all.filter(t => t.status === 'done').reverse(),
  };
}
