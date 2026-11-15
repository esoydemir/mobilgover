import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { Db } from '../../src/db/pool';
import { migrate } from '../../src/db/migrate';
import { buildApp } from '../../src/http/app';
import { DevOutboxMailer } from '../../src/services/mail';
import { LocalStore } from '../../src/storage/local';

/**
 * Acceptance tests run against a real PostgreSQL. Point them at a throwaway
 * database: the schema is dropped and rebuilt for every test file.
 *   TEST_DATABASE_URL        runtime role (not table owner, so RLS applies)
 *   TEST_DATABASE_OWNER_URL  owner role used for migrations and DB-level checks
 */
export function testUrls() {
  const app = process.env.TEST_DATABASE_URL, owner = process.env.TEST_DATABASE_OWNER_URL;
  if (!app || !owner) throw new Error('Set TEST_DATABASE_URL and TEST_DATABASE_OWNER_URL (see server/README.md).');
  return { app, owner };
}

export async function freshEnv(opts: { demoMode?: boolean; allowExampleRules?: boolean; mfaRequiredForPlatform?: boolean; demoLoginDomain?: string; llm?: import('../../src/services/llm').LlmConfig | null } = {}) {
  const urls = testUrls();
  const owner = new pg.Client({ connectionString: urls.owner });
  await owner.connect();
  await owner.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await owner.end();
  await migrate(urls.owner);
  const db = Db.connect(urls.app);
  const dir = await mkdtemp(join(tmpdir(), 'gh-evidence-'));
  const store = new LocalStore(dir);
  const config = {
    demoMode: opts.demoMode ?? true, allowExampleRules: opts.allowExampleRules ?? true, maxUploadBytes: 15 * 1024 * 1024,
    // Test-only key; real deployments read MFA_ENCRYPTION_KEY from the environment.
    mfaEncryptionKey: Buffer.alloc(32, 7).toString('base64'),
    mfaRequiredForPlatform: opts.mfaRequiredForPlatform ?? false,
    demoLoginDomain: opts.demoLoginDomain,
    llm: opts.llm ?? null,
  };
  const app = buildApp({ db, store, mailer: new DevOutboxMailer(db), config });
  /** Direct connection as the owner, for assertions the API deliberately cannot make. */
  const ownerDb = new pg.Client({ connectionString: urls.owner });
  await ownerDb.connect();
  return {
    db, app, store, evidenceDir: dir, ownerDb,
    async close() { await app.close(); await db.close(); await ownerDb.end(); },
  };
}

export type Env = Awaited<ReturnType<typeof freshEnv>>;

/** Tiny HTTP helper around fastify.inject. */
export function client(env: Env, token: string) {
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const isBuf = Buffer.isBuffer(body);
    const res = await env.app.inject({
      method, url, payload: isBuf ? body : body === undefined ? undefined : JSON.stringify(body),
      headers: { authorization: `Bearer ${token}`, ...(isBuf ? {} : body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    });
    const json = String(res.headers['content-type'] ?? '').includes('json');
    return { status: res.statusCode, body: res.body ? (json ? JSON.parse(res.body) : res.rawPayload) : null, headers: res.headers };
  };
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, body?: unknown, headers?: Record<string, string>) => call('POST', url, body ?? {}, headers),
    put: (url: string, body: Buffer, mime: string) => call('PUT', url, body, { 'content-type': mime }),
    patch: (url: string, body: unknown) => call('PATCH', url, body),
    putJson: (url: string, body: unknown) => call('PUT', url, body),
  };
}

/** A minimal valid JPEG header followed by arbitrary bytes. */
export const fakeJpeg = (seed: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(seed)]);
