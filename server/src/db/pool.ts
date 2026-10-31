import pg from 'pg';

// numeric → number, timestamptz → ISO string, date → 'YYYY-MM-DD' (no time-zone shifts).
pg.types.setTypeParser(1700, v => Number(v));
pg.types.setTypeParser(20, v => Number(v));
pg.types.setTypeParser(1184, v => new Date(v).toISOString());
pg.types.setTypeParser(1082, v => v);

export type Tx = pg.PoolClient;

/**
 * Every request runs in one transaction bound to one company. Row-level
 * security then hides all other companies' rows, even if a query forgets
 * its company filter.
 */
export class Db {
  constructor(readonly pool: pg.Pool) {}

  static connect(url: string) {
    return new Db(new pg.Pool({ connectionString: url, max: 10 }));
  }

  tenant<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run(fn, tx => tx.query(`SELECT set_config('app.company_id', $1, true)`, [companyId]));
  }

  /** Platform-level work (rule publishing, sign-in lookup, background jobs). Never used for a user's company request. */
  system<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run(fn, tx => tx.query(`SELECT set_config('app.system', 'on', true)`));
  }

  private async run<T>(fn: (tx: Tx) => Promise<T>, setup: (tx: Tx) => Promise<unknown>): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query('BEGIN');
      await setup(tx);
      const out = await fn(tx);
      await tx.query('COMMIT');
      return out;
    } catch (e) {
      await tx.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      tx.release();
    }
  }

  close() {
    return this.pool.end();
  }
}
