import type { TaskRow } from '../api/types';
import { addDays, dayKey, startOfDay } from './dates';

/**
 * One definition of "today / late / upcoming / done" and of the window the task lists are read from.
 * The home cards, the risk centre and the task list all use this file, so a number on a card is always the
 * length of the list it opens (same data, same filter).
 */
export type TaskFilter = 'today' | 'todo' | 'critical' | 'late' | 'upcoming' | 'service' | 'done';
/** Yapılacaklar · Kritik · Yaklaşan · Servis bekleyenler · Tamamlananlar (+ Bugün, Gecikmiş for the home cards). */
export const TASK_FILTERS: [TaskFilter, string][] = [['today', 'Bugün'], ['todo', 'Yapılacaklar'], ['critical', 'Kritik'], ['late', 'Gecikmiş'], ['upcoming', 'Yaklaşan'], ['service', 'Servis bekleyen'], ['done', 'Tamamlanan']];
/** What each list means, shown above it, so a count is never unexplained. */
export const FILTER_NOTE: Record<TaskFilter, string> = {
  today: 'Bugün son tarihi olan görevler.',
  todo: 'Henüz tamamlanmamış tüm açık görevler.',
  critical: 'Önemi kritik olan ya da son tarihi geçmiş açık görevler. Görev tamamlanınca bu listeden çıkar.',
  late: 'Son tarihi geçmiş açık ve kaçırılmış görevler.',
  upcoming: 'Yarından sonrası için planlanmış kontroller.',
  service: 'Uzman ya da servis talebi açılmış, talebi sürmekte olan görevler (talep tamamlanınca ya da iptal edilince çıkar).',
  done: 'Kayıt ve kanıtlarıyla tamamlanan görevler.',
};
export const isTaskFilter = (v: unknown): v is TaskFilter => TASK_FILTERS.some(([k]) => k === v);

/** -14 … +15 days around today; the same window for every screen. Without a site: every site the person may see. */
export function taskWindowPath(base: string, siteId: string | null) {
  const today = startOfDay();
  const from = encodeURIComponent(addDays(today, -14).toISOString());
  const to = encodeURIComponent(addDays(today, 15).toISOString());
  return `${base}/tasks?${siteId ? `siteId=${siteId}&` : ''}from=${from}&to=${to}`;
}

/** Why a task sits in the critical list and what takes it out. */
export function criticalReason(t: TaskRow, now = new Date()) {
  const late = (t.status === 'open' || t.status === 'missed') && new Date(t.due_at) < now;
  const why = [t.severity === 'critical' ? 'önemi kritik' : null, late ? `son tarih geçti (${new Date(t.due_at).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })})` : null].filter(Boolean).join(' · ');
  return { why, exit: t.status === 'missed' ? 'Kaçırılmış kayıt; sonraki dönem görevi yeni kayıttır.' : 'Görev tamamlanınca listeden çıkar.' };
}

export function bucketTasks(rows: TaskRow[], now = new Date()): Record<TaskFilter, TaskRow[]> & { all: TaskRow[] } {
  const today = startOfDay(now);
  const key = dayKey(today);
  const all = rows.filter(t => t.status !== 'cancelled');
  return {
    all,
    today: all.filter(t => dayKey(new Date(t.due_at)) === key),
    late: all.filter(t => (t.status === 'open' || t.status === 'missed') && new Date(t.due_at) < now),
    todo: all.filter(t => t.status === 'open'),
    critical: all.filter(t => (t.status === 'open' || t.status === 'missed') && (t.severity === 'critical' || new Date(t.due_at) < now)),
    service: all.filter(t => t.status === 'open' && (t.open_services ?? 0) > 0),
    upcoming: all.filter(t => t.status === 'open' && new Date(t.due_at) >= addDays(today, 1)),
    done: all.filter(t => t.status === 'done').reverse(),
  };
}
