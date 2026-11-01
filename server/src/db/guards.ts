import type { Db } from './pool';

/**
 * Demo sign-in (codes readable from the demo outbox) must never reach real
 * data. A demo deployment therefore refuses to start on a database that holds
 * any non-demo business.
 */
export async function assertDemoDatabase(db: Db): Promise<void> {
  const n = await db.system(async tx => (await tx.query(`SELECT count(*)::int AS n FROM companies WHERE NOT is_demo`)).rows[0].n as number);
  if (n > 0) throw new Error(`DEMO_MODE=true bu veritabanında kullanılamaz: ${n} gerçek (demo olmayan) işletme var. Demo için ayrı bir veritabanı kullan.`);
}
