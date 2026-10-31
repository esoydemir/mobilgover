import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApi } from '../../../mobile/src/api/client';
import { NetworkError } from '../../../mobile/src/api/errors';
import { MSG, SyncEngine, type Auth, type Saved, type Transport } from '../../../mobile/src/api/syncEngine';
import { localDay } from '../../src/domain/schedule';
import { createSession } from '../../src/services/principal';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { fakeJpeg, freshEnv, type Env } from '../support/env';

/**
 * Offline sync, automated. The app's own queue engine (mobile/src/api/syncEngine.ts)
 * and HTTP client run against the real API over real HTTP on a random port, backed by
 * real PostgreSQL. Faults (no network, lost answers, cut uploads, ended sessions) are
 * injected in the transport between the two. Rules and limits are EXAMPLES.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let real: Transport;
let tasks: string[] = [];
const C = () => `/companies/${demo.companyId}`;
const today = localDay(new Date(), 'Europe/Istanbul');

/** A device: its disk survives an engine being thrown away (the app being closed). */
function device() {
  let disk: string | null = null;
  return {
    persist: { load: async () => (disk ? JSON.parse(disk) as Saved : null), save: async (s: Saved) => { disk = JSON.stringify(s); } },
    peek: () => (disk ? JSON.parse(disk) as Saved : null),
  };
}
let keyN = 0;
function engine(dev: ReturnType<typeof device>, auth: () => Auth, transport: Transport = real) {
  return new SyncEngine({ transport, persist: dev.persist, auth, newKey: () => `op-test-${Date.now()}-${++keyN}`, onChange: () => {} });
}
const offline: Transport = async () => { throw new NetworkError('offline'); };

function photo(seed: string) {
  const bytes = fakeJpeg(seed);
  return { bytes, file: { base64: bytes.toString('base64'), mime: 'image/jpeg', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length } };
}
/** The three records a field worker makes for a fridge check. */
function enqueueFridgeCheck(e: SyncEngine, taskId: string, value: number, seed: string) {
  const p = photo(seed);
  const base = `${C()}/tasks/${taskId}`;
  e.enqueue({ companyId: demo.companyId, taskId, label: 'ölçüm', path: `${base}/measurements`, body: { quantity: 'temperature', value, unit: '°C', measuredAt: new Date().toISOString(), instrumentId: demo.thermometerId } });
  e.enqueue({ companyId: demo.companyId, taskId, label: 'fotoğraf', path: `${base}/evidence`, body: { kind: 'photo', mime: 'image/jpeg', sha256: p.file.sha256, sizeBytes: p.file.size }, file: p.file });
  e.enqueue({ companyId: demo.companyId, taskId, label: 'tamamla', path: `${base}/complete`, body: { clientCompletedAt: new Date().toISOString() } });
  return p;
}
const q = async (sql: string, args: unknown[] = []) => (await env.ownerDb.query(sql, args)).rows;
const ownerAuth = () => ({ token: demo.users.owner.token, userId: demo.users.owner.id });
const nextTask = () => tasks.shift()!;

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  real = makeApi(`http://127.0.0.1:${(env.app.server.address() as AddressInfo).port}`);
  await real('POST', `${C()}/tasks/generate`, { token: demo.users.owner.token, body: { siteId: demo.siteId, fromDay: today, toDay: localDay(new Date(Date.now() + 9 * 86400_000), 'Europe/Istanbul') } });
  const list = await real<any[]>('GET', `${C()}/tasks?siteId=${demo.siteId}`, { token: demo.users.owner.token });
  tasks = list.filter(t => t.equipment_id === demo.fridgeId && t.status === 'open').map(t => t.id);
  expect(tasks.length).toBeGreaterThanOrEqual(6);
});
afterAll(async () => { await env?.close(); });

describe('1 · closing and reopening the app', () => {
  it('records made offline survive a restart and arrive in order, once', async () => {
    const dev = device();
    const taskId = nextTask();
    const a = engine(dev, ownerAuth, offline);
    enqueueFridgeCheck(a, taskId, 3, 'restart');
    expect(await a.syncNow()).toMatchObject({ offline: true, sent: 0 });
    await a.flushed();
    expect(dev.peek()!.ops.map(o => [o.label, o.status])).toEqual([['ölçüm', 'pending'], ['fotoğraf', 'pending'], ['tamamla', 'pending']]);
    // App closed. A new process reads the same disk and the network is back.
    const b = engine(dev, ownerAuth);
    await b.load();
    expect(b.ops).toHaveLength(3);
    expect(await b.syncNow()).toMatchObject({ sent: 3, offline: false });
    expect(b.ops).toEqual([]);
    const t = await real<any>('GET', `${C()}/tasks/${taskId}`, { token: demo.users.owner.token });
    expect(t.status).toBe('done');
    expect(await q(`SELECT count(*)::int AS n FROM measurements WHERE task_id = $1`, [taskId])).toEqual([{ n: 1 }]);
    expect(await q(`SELECT status FROM evidence WHERE task_id = $1 AND kind = 'photo'`, [taskId])).toEqual([{ status: 'stored' }]);
  });

  it('an app killed mid-send resends after restart and the server does not duplicate', async () => {
    const dev = device();
    const taskId = nextTask();
    let reached = 0;
    // The request reaches the server, then the app dies before reading the answer.
    const dies: Transport = async (m, p, o) => { await real(m, p, o); reached++; return new Promise(() => {}); };
    const a = engine(dev, ownerAuth, dies);
    enqueueFridgeCheck(a, taskId, 3, 'killed');
    void a.syncNow();
    await new Promise(r => setTimeout(r, 300));
    await a.flushed();
    expect(reached).toBe(1);
    expect(dev.peek()!.ops[0]!.status).toBe('syncing');

    const b = engine(dev, ownerAuth);
    await b.load();
    expect(b.ops[0]!.status).toBe('pending');
    expect((await b.syncNow()).sent).toBe(3);
    expect(await q(`SELECT count(*)::int AS n FROM measurements WHERE task_id = $1`, [taskId])).toEqual([{ n: 1 }]);
    expect(await q(`SELECT count(*)::int AS n FROM audit_events WHERE company_id = $1 AND event_type = 'measurement.recorded' AND entity_id IN (SELECT id::text FROM measurements WHERE task_id = $2)`, [demo.companyId, taskId])).toEqual([{ n: 1 }]);
  });
});

describe('2 · the same record sent again', () => {
  it('lost answers lead to resends that the server answers from its record, without a second write', async () => {
    const dev = device();
    const taskId = nextTask();
    const lostOnce = new Set<string>();
    // Every request reaches the server once with its answer lost; the resend gets through.
    const flaky: Transport = async (m, p, o) => {
      const r = await real(m, p, o);
      const k = `${m} ${p} ${o?.idempotencyKey ?? ''}`;
      if (!lostOnce.has(k)) { lostOnce.add(k); throw new NetworkError('answer lost'); }
      return r;
    };
    const e = engine(dev, ownerAuth, flaky);
    enqueueFridgeCheck(e, taskId, 3, 'resend');
    for (let i = 0; i < 10 && e.ops.length; i++) await e.syncNow();
    expect(e.ops).toEqual([]);
    expect(await q(`SELECT count(*)::int AS n FROM measurements WHERE task_id = $1`, [taskId])).toEqual([{ n: 1 }]);
    expect(await q(`SELECT status, count(*)::int AS n FROM evidence WHERE task_id = $1 AND kind = 'photo' GROUP BY status`, [taskId])).toEqual([{ status: 'stored', n: 1 }]);
    expect(await q(`SELECT count(*)::int AS n FROM audit_events WHERE company_id = $1 AND event_type = 'task.completed' AND entity_id = $2`, [demo.companyId, taskId])).toEqual([{ n: 1 }]);
  });
});

describe('3 · half-finished photo uploads', () => {
  it('bytes that never arrived are sent again into the same record', async () => {
    const dev = device();
    const taskId = nextTask();
    let cut = true;
    const dropPut: Transport = async (m, p, o) => { if (m === 'PUT' && cut) { cut = false; throw new NetworkError('connection dropped'); } return real(m, p, o); };
    const e = engine(dev, ownerAuth, dropPut);
    enqueueFridgeCheck(e, taskId, 3, 'drop');
    await e.syncNow();
    const photoOp = e.ops.find(o => o.label === 'fotoğraf')!;
    expect(photoOp).toMatchObject({ status: 'pending', error: MSG.offline });
    expect(photoOp.evidenceId).toBeTruthy();
    expect(await q(`SELECT status FROM evidence WHERE id = $1`, [photoOp.evidenceId])).toEqual([{ status: 'pending_upload' }]);
    await e.syncNow();
    expect(e.ops).toEqual([]);
    expect(await q(`SELECT status, count(*)::int AS n FROM evidence WHERE task_id = $1 AND kind = 'photo' GROUP BY status`, [taskId])).toEqual([{ status: 'stored', n: 1 }]);
  });

  it('a cut-off file that reached the server is rejected and kept on record; the device keeps the photo and retries into a new record', async () => {
    const dev = device();
    const taskId = nextTask();
    let truncate = true;
    const halfPut: Transport = async (m, p, o) => {
      if (m === 'PUT' && truncate && o?.bytes) { truncate = false; return real(m, p, { ...o, bytes: { ...o.bytes, data: o.bytes.data.slice(0, Math.ceil(o.bytes.data.length / 2)) } }); }
      return real(m, p, o);
    };
    const e = engine(dev, ownerAuth, halfPut);
    const p = enqueueFridgeCheck(e, taskId, 3, 'half');
    await e.syncNow();
    const op = e.ops.find(o => o.label === 'fotoğraf')!;
    expect(op.status).toBe('failed');
    expect(op.error).toContain('özet');
    expect(op.evidenceId).toBeUndefined();
    expect(op.file!.sha256).toBe(p.file.sha256);
    // Completion waits behind it and is refused while the photo is missing; nothing is lost.
    expect(e.ops.map(o => o.label)).toEqual(['fotoğraf', 'tamamla']);
    e.retry(op.id);
    e.retry(e.ops.find(o => o.label === 'tamamla')!.id);
    await e.syncNow();
    expect(e.ops).toEqual([]);
    const rows = await q(`SELECT status, sha256 FROM evidence WHERE task_id = $1 AND kind = 'photo' ORDER BY created_at`, [taskId]);
    expect(rows.map(r => r.status)).toEqual(['rejected', 'stored']);
    expect(rows[1].sha256).toBe(p.file.sha256);
    expect((await real<any>('GET', `${C()}/tasks/${taskId}`, { token: demo.users.owner.token })).status).toBe('done');
  });

  it('when the answer to an upload is lost, the device trusts the server: stored counts as sent, rejected never does', async () => {
    const taskId = nextTask();
    // Stored, answer lost.
    let lose = true;
    const lostOk: Transport = async (m, p, o) => { const r = await real(m, p, o); if (m === 'PUT' && lose) { lose = false; throw new NetworkError('answer lost'); } return r; };
    const e1 = engine(device(), ownerAuth, lostOk);
    enqueueFridgeCheck(e1, taskId, 3, 'lost-ok');
    for (let i = 0; i < 3 && e1.ops.length; i++) await e1.syncNow();
    expect(e1.ops).toEqual([]);
    expect(e1.recent.find(r => r.label === 'fotoğraf')!.result).toMatchObject({ status: 'stored' });

    // Rejected, answer lost: must not be shown as sent.
    const t2 = nextTask();
    let first = true;
    const lostReject: Transport = async (m, p, o) => {
      if (m === 'PUT' && first && o?.bytes) {
        first = false;
        await real(m, p, { ...o, bytes: { ...o.bytes, data: o.bytes.data.slice(0, 5) } }).catch(() => undefined);
        throw new NetworkError('answer lost');
      }
      return real(m, p, o);
    };
    const e2 = engine(device(), ownerAuth, lostReject);
    enqueueFridgeCheck(e2, t2, 3, 'lost-reject');
    await e2.syncNow();
    await e2.syncNow();
    const op = e2.ops.find(o => o.label === 'fotoğraf')!;
    expect(op.status).toBe('failed');
    expect(e2.recent.some(r => r.label === 'fotoğraf')).toBe(false);
  });
});

describe('4 · the session ends during sync', () => {
  it('waiting records stay on the device and go out after signing in again; another user never sends them', async () => {
    const dev = device();
    const taskId = nextTask();
    let token = await env.db.system(tx => createSession(tx, demo.users.owner.id));
    const auth = () => ({ token, userId: demo.users.owner.id });
    let n = 0;
    // After the first record, the session is ended (signed out elsewhere / expired).
    const endsAfterOne: Transport = async (m, p, o) => {
      const r = await real(m, p, o);
      if (++n === 1) await real('POST', '/auth/logout', { token });
      return r;
    };
    const e = engine(dev, auth, endsAfterOne);
    enqueueFridgeCheck(e, taskId, 3, 'session');
    const r = await e.syncNow();
    expect(r).toMatchObject({ sent: 1, authRequired: true });
    expect(e.ops.map(o => [o.label, o.status, o.error])).toEqual([['fotoğraf', 'pending', MSG.login], ['tamamla', 'pending', MSG.login]]);

    // Someone else signs in on this phone: the owner's records are not sent under their name.
    const staffEngine = engine(dev, () => ({ token: demo.users.staff.token, userId: demo.users.staff.id }));
    await staffEngine.load();
    expect((await staffEngine.syncNow()).sent).toBe(0);
    expect(staffEngine.ops.every(o => o.error === MSG.otherUser)).toBe(true);

    // The owner signs in again.
    token = await env.db.system(tx => createSession(tx, demo.users.owner.id));
    const again = engine(dev, auth);
    await again.load();
    expect((await again.syncNow()).sent).toBe(2);
    expect((await real<any>('GET', `${C()}/tasks/${taskId}`, { token })).status).toBe('done');
    expect(await q(`SELECT DISTINCT actor_id FROM audit_events WHERE company_id = $1 AND entity_id IN
                     (SELECT id::text FROM evidence WHERE task_id = $2)`, [demo.companyId, taskId])).toEqual([{ actor_id: demo.users.owner.id }]);
  });
});

describe('5 · two devices act on the same task', () => {
  it('the first to arrive wins; the other device shows a conflict and nothing of it is written', async () => {
    const taskId = nextTask();
    const managerAuth = () => ({ token: demo.users.manager.token, userId: demo.users.manager.id });
    const phoneA = engine(device(), ownerAuth, offline);
    const phoneB = engine(device(), managerAuth, offline);
    enqueueFridgeCheck(phoneA, taskId, 3, 'device-a');
    enqueueFridgeCheck(phoneB, taskId, 2.5, 'device-b');
    await phoneA.syncNow(); await phoneB.syncNow();

    const a = engine(device(), ownerAuth);
    // Hand phone A's saved queue to an online engine (same disk, network back).
    (a as any).deps.persist = (phoneA as any).deps.persist;
    await a.load();
    expect((await a.syncNow()).sent).toBe(3);

    const b = engine(device(), managerAuth);
    (b as any).deps.persist = (phoneB as any).deps.persist;
    await b.load();
    await b.syncNow();
    expect(b.ops.map(o => o.status)).toEqual(['conflict', 'conflict', 'conflict']);
    expect(b.ops.every(o => (o.error ?? '').length > 0)).toBe(true);

    const values = await q(`SELECT value::float AS v, recorded_by FROM measurements WHERE task_id = $1`, [taskId]);
    expect(values).toEqual([{ v: 3, recorded_by: demo.users.owner.id }]);
    expect(await q(`SELECT count(*)::int AS n FROM evidence WHERE task_id = $1 AND kind = 'photo'`, [taskId])).toEqual([{ n: 1 }]);
    // Conflicts stay until the user decides.
    b.discard(b.ops[0]!.id);
    expect(b.ops).toHaveLength(2);
  });
});
