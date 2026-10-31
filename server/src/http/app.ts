import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { redact } from '../ops/notify';
import type { Config } from '../config';
import type { Db, Tx } from '../db/pool';
import { AppError, forbidden, notFound } from '../domain/errors';
import { canonical, sha256 } from '../domain/hashchain';
import { can, type Principal } from '../domain/permissions';
import { verifyCompanyChain } from '../services/audit';
import { uploadContent } from '../services/evidence';
import { closeNonconformity, completeStep, getNonconformity } from '../services/nonconformities';
import { currentObligations, explain, overrideNotApplicable, recomputeSite } from '../services/obligations';
import { confirmTotpSetup, listSessions, logout, revokeOtherSessions, revokeSession, startEmailLogin, startTotpSetup, verifyEmailLogin, verifyMfaLogin } from '../services/auth';
import { acceptInvitation, addMember, createCompany, listMyCompanies, listMyInvitations, setMemberStatus } from '../services/companies';
import type { Mailer } from '../services/mail';
import { loadPrincipal } from '../services/principal';
import * as mk from '../services/marketplace';
import { approveRetention, listRetention, proposeRetention } from '../services/retention';
import { currentFacts, recordFact, syncEquipmentTypes } from '../services/profile';
import { auditExport, indicators } from '../services/reporting';
import { approve, areaReview, createDraft, draftSchema, listRuleVersions, previewImpact, publish, submitForReview } from '../services/rules';
import { FACTS } from '../domain/facts';
import { addEvidence, completeTask, generateTasks, listTasks, recordMeasurement, taskDetail } from '../services/tasks';
import { ALLOWED_MIME, type EvidenceStore } from '../storage/local';

declare module 'fastify' {
  interface FastifyRequest { principal: Principal }
}

const uuid = z.uuid();
const companyParams = z.object({ companyId: uuid });

/**
 * Builds the API. Every route: authenticate → check permission in the
 * service → run inside a company-bound transaction (row-level security).
 */
export type AppConfig = Pick<Config, 'demoMode' | 'allowExampleRules' | 'maxUploadBytes' | 'mfaEncryptionKey' | 'mfaRequiredForPlatform'> & { corsOrigins?: string[]; mailProductionReady?: boolean };
/** Structured log sink. Lines carry route templates and status codes only — never bodies, query strings, headers or tokens. */
export type LogSink = (line: Record<string, unknown>) => void;

/** Routes that work without a session. */
const PUBLIC = new Set(['/health', '/env', '/auth/email/start', '/auth/email/verify', '/auth/mfa/verify', '/dev/outbox/latest']);

export function buildApp(deps: { db: Db; store: EvidenceStore; mailer: Mailer; config: AppConfig; log?: LogSink }) {
  const { db, store, mailer, config } = deps;
  const log: LogSink = deps.log ?? (() => {});
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  app.addHook('onResponse', async (req, reply) => {
    log({ level: 'info', method: req.method, route: req.routeOptions.url ?? 'unknown', status: reply.statusCode, ms: Math.round(reply.elapsedTime) });
  });

  for (const mime of ALLOWED_MIME) {
    app.addContentTypeParser(mime, { parseAs: 'buffer', bodyLimit: config.maxUploadBytes }, (_req, body, done) => done(null, body));
  }

  // CORS for the web build of the app: only listed origins, never "*".
  const origins = new Set(config.corsOrigins ?? []);
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && origins.has(origin)) {
      reply.header('access-control-allow-origin', origin);
      reply.header('vary', 'origin');
      reply.header('access-control-allow-headers', 'authorization, content-type, idempotency-key');
      reply.header('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
      reply.header('access-control-expose-headers', 'idempotent-replay');
      reply.header('access-control-max-age', '600');
    }
    if (req.method === 'OPTIONS') return reply.code(origin && origins.has(origin) ? 204 : 403).send();
  });

  // Simple per-token rate limit; a shared store (e.g. Redis) replaces this when running several instances.
  const hits = new Map<string, { n: number; reset: number }>();
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const key = token ? sha256(token) : `ip:${req.ip}`;
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + 60_000 });
    else if (++h.n > 300) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Çok fazla istek; bir dakika sonra tekrar dene.' } });
    if (PUBLIC.has(path)) return;
    if (!token) return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Oturum gerekli.' } });
    const p = await loadPrincipal(db, token);
    if (!p) return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Oturum geçersiz veya süresi dolmuş.' } });
    req.principal = p;
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof z.ZodError) return reply.code(422).send({ error: { code: 'INVALID', message: 'İstek alanları geçersiz.', details: err.issues } });
    if (err.code === '23505') return reply.code(409).send({ error: { code: 'DUPLICATE', message: 'Bu kayıt zaten var.' } });
    if (err.code === 'P0001') return reply.code(409).send({ error: { code: 'INTEGRITY_GUARD', message: 'Kayıt koruması bu değişikliğe izin vermiyor.', details: err.message } });
    if (err.code === '42501') return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Kayıt bulunamadı.' } });
    if (err.statusCode === 413) return reply.code(413).send({ error: { code: 'TOO_LARGE', message: 'Dosya çok büyük.' } });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: { code: 'BAD_REQUEST', message: err.message } });
    log({ level: 'error', route: _req.routeOptions.url ?? 'unknown', code: err.code ?? null, message: redact(String(err.message ?? err)) });
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Beklenmeyen bir hata oluştu; kayıt yapılmadı.' } });
  });

  /** A company is only reachable through a membership or grant; otherwise it does not exist for this user. */
  const company = (req: FastifyRequest) => {
    const { companyId } = companyParams.parse(req.params);
    const p = req.principal;
    const known = p.memberships.some(m => m.companyId === companyId) || p.grants.some(g => g.companyId === companyId);
    if (!known) throw notFound('İşletme');
    return companyId;
  };

  /**
   * Runs a mutation once per Idempotency-Key. A retried request (e.g. an
   * offline queue resending) gets the stored response instead of a second write.
   */
  async function mutate(req: FastifyRequest, reply: FastifyReply, companyId: string, fn: (tx: Tx) => Promise<unknown>, status = 200) {
    const key = req.headers['idempotency-key'];
    const opKey = typeof key === 'string' && key.length >= 8 && key.length <= 128 ? key : null;
    const reqHash = sha256(canonical({ url: req.url, method: req.method, body: Buffer.isBuffer(req.body) ? sha256(req.body) : req.body ?? null }));
    const out = await db.tenant(companyId, async tx => {
      if (opKey) {
        const prev = (await tx.query(`SELECT * FROM client_operations WHERE company_id = $1 AND op_key = $2`, [companyId, opKey])).rows[0];
        if (prev) {
          if (prev.request_hash !== reqHash || prev.user_id !== req.principal.userId) {
            throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Bu işlem anahtarı farklı bir istekle kullanılmış.');
          }
          return { replay: true, status: prev.status_code, body: prev.response };
        }
      }
      const body = await fn(tx);
      if (opKey) {
        await tx.query(`INSERT INTO client_operations (company_id, op_key, user_id, request_hash, status_code, response) VALUES ($1,$2,$3,$4,$5,$6)`,
          [companyId, opKey, req.principal.userId, reqHash, status, JSON.stringify(body ?? null)]);
      }
      return { replay: false, status, body };
    });
    if (out.replay) reply.header('idempotent-replay', 'true');
    return reply.code(out.status).send(out.body);
  }

  /** Rule and platform administration needs a second factor on the session. */
  const platformGate = (req: FastifyRequest) => {
    if (config.mfaRequiredForPlatform && !req.principal.mfaSatisfied) {
      throw new AppError(403, 'MFA_REQUIRED', 'Bu işlem için ek doğrulama (kimlik doğrulayıcı uygulama) gerekiyor.');
    }
  };

  app.get('/health', async () => ({ ok: true }));

  // Lets the app show clearly whether it is talking to demo or pilot data.
  app.get('/env', async () => ({
    mode: config.demoMode ? 'demo' : 'pilot',
    exampleRulesAllowed: config.allowExampleRules,
    mailTransport: mailer.kind,
    // True only after a person confirmed a real delivery through the chosen provider.
    mailProductionReady: mailer.kind === 'smtp' && config.mailProductionReady === true,
  }));

  // ── Sign-in ──
  app.post('/auth/email/start', async req => {
    const { email } = z.object({ email: z.string().max(254) }).parse(req.body);
    return startEmailLogin(db, mailer, email);
  });
  app.post('/auth/email/verify', async req => {
    const b = z.object({ email: z.string().max(254), code: z.string().max(12) }).parse(req.body);
    return verifyEmailLogin(db, b.email, b.code.trim());
  });
  app.post('/auth/mfa/verify', async req => {
    const b = z.object({ ticket: z.string().max(100), code: z.string().max(12) }).parse(req.body);
    return verifyMfaLogin(db, config.mfaEncryptionKey, b.ticket, b.code.trim());
  });
  app.post('/auth/mfa/totp/setup', async req => startTotpSetup(db, config.mfaEncryptionKey, req.principal.userId));
  app.post('/auth/mfa/totp/confirm', async req => {
    const { code } = z.object({ code: z.string().max(12) }).parse(req.body);
    return confirmTotpSetup(db, config.mfaEncryptionKey, req.principal.userId, (req.headers.authorization ?? '').slice(7), code.trim());
  });
  app.post('/auth/logout', async req => { await logout(db, (req.headers.authorization ?? '').slice(7)); return { ok: true }; });
  app.get('/auth/sessions', async req => listSessions(db, req.principal.userId, req.principal.sessionId));
  app.post('/auth/sessions/:sessionId/revoke', async req => revokeSession(db, req.principal.userId, z.object({ sessionId: uuid }).parse(req.params).sessionId));
  app.post('/auth/sessions/revoke-others', async req => revokeOtherSessions(db, req.principal.userId, req.principal.sessionId));
  app.get('/me/invitations', async req => listMyInvitations(db, req.principal));
  app.post('/me/invitations/:membershipId/accept', async req => acceptInvitation(db, req.principal, z.object({ membershipId: uuid }).parse(req.params).membershipId));

  // Demo deployments only: read the sign-in mail that the dev outbox kept. Never available in pilot.
  app.get('/dev/outbox/latest', async req => {
    if (!config.demoMode) throw notFound('Sayfa');
    const { email } = z.object({ email: z.string() }).parse(req.query);
    const r = await db.system(tx => tx.query(`SELECT subject, body, created_at FROM dev_mail_outbox WHERE to_email = $1 ORDER BY id DESC LIMIT 1`, [email.trim().toLowerCase()]));
    if (!r.rows[0]) throw notFound('Posta');
    return r.rows[0];
  });

  app.get('/me', async req => ({
    userId: req.principal.userId, email: req.principal.email, displayName: req.principal.displayName,
    mfaEnabled: req.principal.mfaEnabled, mfaSatisfied: req.principal.mfaSatisfied,
    platformRoles: req.principal.platformRoles, memberships: req.principal.memberships, grants: req.principal.grants,
  }));

  // ── Companies ──
  app.get('/companies', async req => listMyCompanies(db, req.principal));
  app.post('/companies', async (req, reply) => {
    const b = z.object({ name: z.string().trim().min(2).max(120), siteName: z.string().trim().min(2).max(120), timezone: z.string().default('Europe/Istanbul') }).parse(req.body);
    return reply.code(201).send(await createCompany(db, req.principal, b, config.demoMode));
  });
  app.get('/companies/:companyId/members', async req => {
    const companyId = company(req);
    if (!can(req.principal, 'members.manage', { companyId }).ok) throw forbidden();
    return db.system(async tx => (await tx.query(
      `SELECT m.id AS membership_id, u.id, u.display_name, u.email, m.role, m.site_id, m.status, m.invite_expires_at, m.suspend_reason,
              (m.status = 'invited' AND m.invite_expires_at <= now()) AS invite_expired, (u.email_verified_at IS NOT NULL) AS signed_in
         FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = $1 ORDER BY m.created_at`, [companyId])).rows);
  });
  app.post('/companies/:companyId/members/:membershipId/:action', async (req, reply) => {
    const companyId = company(req);
    const { membershipId, action } = z.object({ membershipId: uuid, action: z.enum(['suspend', 'reactivate', 'cancel_invite']) }).parse(req.params);
    const b = z.object({ reason: z.string().max(500).default('') }).parse(req.body ?? {});
    return mutate(req, reply, companyId, tx => setMemberStatus(tx, req.principal, companyId, membershipId, action, b.reason));
  });
  app.post('/companies/:companyId/members', async (req, reply) => {
    const companyId = company(req);
    const b = z.object({ email: z.email(), role: z.enum(['hq_manager', 'site_manager', 'staff']), siteId: uuid.nullable().default(null) }).parse(req.body);
    return mutate(req, reply, companyId, tx => addMember(tx, req.principal, companyId, b), 201);
  });

  /** Profile questions the rules can use, with labels for the app. */
  app.get('/fact-catalog', async () => Object.entries(FACTS).map(([key, d]) => ({ key, ...d })));

  // ── Profile ──
  app.get('/companies/:companyId/sites/:siteId/profile', async req => {
    const companyId = company(req);
    const { siteId } = z.object({ siteId: uuid }).parse(req.params);
    if (!can(req.principal, 'profile.read', { companyId, siteId }).ok) throw forbidden();
    return db.tenant(companyId, tx => currentFacts(tx, companyId, siteId));
  });

  const factBody = z.object({
    siteId: uuid.nullable(), key: z.string(), value: z.unknown(),
    source: z.enum(['user_declared', 'ocr', 'expert']),
    verification: z.enum(['unverified', 'user_confirmed', 'expert_verified', 'rejected']),
    sourceRef: z.string().max(200).nullable().optional(), confidence: z.number().min(0).max(1).nullable().optional(),
    validFrom: z.iso.date().nullable().optional(), validTo: z.iso.date().nullable().optional(), note: z.string().max(500).nullable().optional(),
  });
  app.post('/companies/:companyId/profile/facts', async (req, reply) => {
    const companyId = company(req);
    const body = factBody.parse(req.body);
    return mutate(req, reply, companyId, async tx => {
      const id = await recordFact(tx, req.principal, companyId, body);
      const sites = body.siteId ? [body.siteId] : (await tx.query<{ id: string }>(`SELECT id FROM sites WHERE company_id = $1`, [companyId])).rows.map(r => r.id);
      const recomputed = [];
      for (const s of sites) recomputed.push({ siteId: s, ...(await recomputeSite(tx, companyId, s, req.principal.userId)) });
      return { id, recomputed };
    }, 201);
  });

  // ── Equipment ──
  app.post('/companies/:companyId/equipment', async (req, reply) => {
    const companyId = company(req);
    const b = z.object({ siteId: uuid, type: z.string().regex(/^[a-z_]+$/), name: z.string().min(2), serial: z.string().nullable().optional(), calibratedUntil: z.iso.date().nullable().optional() }).parse(req.body);
    if (!can(req.principal, 'equipment.write', { companyId, siteId: b.siteId }).ok) throw forbidden();
    return mutate(req, reply, companyId, async tx => {
      const id = (await tx.query<{ id: string }>(`INSERT INTO equipment (company_id, site_id, type, name, serial, calibrated_until) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [companyId, b.siteId, b.type, b.name, b.serial ?? null, b.calibratedUntil ?? null])).rows[0]!.id;
      await syncEquipmentTypes(tx, companyId, b.siteId);
      await recomputeSite(tx, companyId, b.siteId, req.principal.userId);
      return { id };
    }, 201);
  });

  app.get('/companies/:companyId/sites/:siteId/equipment', async req => {
    const companyId = company(req);
    const { siteId } = z.object({ siteId: uuid }).parse(req.params);
    if (!can(req.principal, 'equipment.read', { companyId, siteId }).ok && !can(req.principal, 'task.generate', { companyId, siteId }).ok) throw forbidden();
    return db.tenant(companyId, async tx => (await tx.query(
      `SELECT id, type, name, serial, calibrated_until, active FROM equipment WHERE company_id = $1 AND site_id = $2 ORDER BY name`, [companyId, siteId])).rows);
  });

  // ── Obligations ──
  app.get('/companies/:companyId/obligations', async req => {
    const companyId = company(req);
    const { siteId } = z.object({ siteId: uuid.optional() }).parse(req.query);
    if (!can(req.principal, 'obligation.read', { companyId, siteId: siteId ?? null }).ok) throw forbidden();
    const rows = await db.tenant(companyId, tx => currentObligations(tx, companyId, siteId));
    return rows.map(o => ({ id: o.id, siteId: o.site_id, rule: o.rule_code, version: o.rule_version, title: o.obligation_title, kind: o.kind,
      isExample: o.is_example, decision: o.decision, reason: o.reason, missingFacts: o.missing_facts, decidedBy: o.decided_by, decidedAt: o.decided_at }));
  });
  app.get('/companies/:companyId/obligations/:id/explanation', async req => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return db.tenant(companyId, tx => explain(tx, req.principal, companyId, id));
  });
  app.post('/companies/:companyId/obligations/:id/not-applicable', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { reason } = z.object({ reason: z.string() }).parse(req.body);
    return mutate(req, reply, companyId, async tx => ({ id: await overrideNotApplicable(tx, req.principal, companyId, id, reason) }), 201);
  });

  // ── Tasks ──
  app.post('/companies/:companyId/tasks/generate', async (req, reply) => {
    const companyId = company(req);
    const b = z.object({ siteId: uuid, fromDay: z.iso.date(), toDay: z.iso.date() }).parse(req.body);
    if (!can(req.principal, 'task.generate', { companyId, siteId: b.siteId }).ok) throw forbidden();
    if (b.toDay < b.fromDay || (Date.parse(b.toDay) - Date.parse(b.fromDay)) / 86400000 > 62) throw new AppError(422, 'INVALID', 'Aralık en fazla 62 gün olabilir.');
    return mutate(req, reply, companyId, tx => generateTasks(tx, companyId, b.siteId, b.fromDay, b.toDay));
  });
  app.get('/companies/:companyId/tasks', async req => {
    const companyId = company(req);
    const q = z.object({ siteId: uuid.optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(),
      status: z.enum(['open', 'done', 'missed', 'cancelled']).optional() }).parse(req.query);
    return db.tenant(companyId, tx => listTasks(tx, req.principal, companyId, q));
  });
  app.get('/companies/:companyId/tasks/:taskId', async req => {
    const companyId = company(req);
    const { taskId } = z.object({ taskId: uuid }).parse(req.params);
    return db.tenant(companyId, tx => taskDetail(tx, req.principal, companyId, taskId));
  });
  app.post('/companies/:companyId/tasks/:taskId/measurements', async (req, reply) => {
    const companyId = company(req);
    const { taskId } = z.object({ taskId: uuid }).parse(req.params);
    const b = z.object({ quantity: z.string(), value: z.number().finite(), unit: z.string(), measuredAt: z.iso.datetime({ offset: true }),
      instrumentId: uuid.nullable().optional(), productCategory: z.string().optional() }).parse(req.body);
    return mutate(req, reply, companyId, tx => recordMeasurement(tx, req.principal, companyId, taskId, b), 201);
  });
  const evidenceBody = z.discriminatedUnion('kind', [
    z.object({ kind: z.enum(['photo', 'document', 'device_record']), mime: z.string(), sha256: z.string(), sizeBytes: z.number().int().positive().max(config.maxUploadBytes) }),
    z.object({ kind: z.literal('note'), text: z.string().max(4000) }),
    z.object({ kind: z.literal('checklist'), answers: z.record(z.string(), z.enum(['pass', 'fail', 'na'])) }),
    z.object({ kind: z.literal('approval'), role: z.enum(['owner', 'hq_manager', 'site_manager']) }),
  ]);
  app.post('/companies/:companyId/tasks/:taskId/evidence', async (req, reply) => {
    const companyId = company(req);
    const { taskId } = z.object({ taskId: uuid }).parse(req.params);
    const b = evidenceBody.parse(req.body);
    return mutate(req, reply, companyId, tx => addEvidence(tx, req.principal, companyId, taskId, b), 201);
  });
  app.put('/companies/:companyId/evidence/:evidenceId/content', async req => {
    const companyId = company(req);
    const { evidenceId } = z.object({ evidenceId: uuid }).parse(req.params);
    if (!Buffer.isBuffer(req.body)) throw new AppError(415, 'UNSUPPORTED_MEDIA', `Dosya gövdesi şu türlerden biri olmalı: ${ALLOWED_MIME.join(', ')}`);
    return uploadContent(db, store, req.principal, companyId, evidenceId, req.body);
  });
  app.post('/companies/:companyId/tasks/:taskId/complete', async (req, reply) => {
    const companyId = company(req);
    const { taskId } = z.object({ taskId: uuid }).parse(req.params);
    const b = z.object({ clientCompletedAt: z.iso.datetime({ offset: true }).optional() }).parse(req.body ?? {});
    return mutate(req, reply, companyId, tx => completeTask(tx, req.principal, companyId, taskId, b.clientCompletedAt));
  });

  // ── Nonconformities ──
  app.get('/companies/:companyId/nonconformities', async req => {
    const companyId = company(req);
    const { status } = z.object({ status: z.enum(['open', 'closed']).optional() }).parse(req.query);
    return db.tenant(companyId, async tx => (await tx.query(
      `SELECT id, site_id, title, risk_level, depth, status, recurrence_count, detected_at, closed_at, due_at, owner_id
         FROM nonconformities WHERE company_id = $1 AND ($2::text IS NULL OR ($2 = 'closed') = (status = 'closed')) ORDER BY detected_at DESC`,
      [companyId, status ?? null])).rows.filter(n => can(req.principal, 'ncr.read', { companyId, siteId: n.site_id, assigneeId: n.owner_id }).ok));
  });
  app.get('/companies/:companyId/nonconformities/:id', async req => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return db.tenant(companyId, tx => getNonconformity(tx, req.principal, companyId, id));
  });
  app.post('/companies/:companyId/nonconformities/:id/steps', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ step: z.enum(['containment', 'correction', 'root_cause', 'corrective_action', 'effectiveness_check']), notes: z.string().max(4000) }).parse(req.body);
    return mutate(req, reply, companyId, async tx => { await completeStep(tx, req.principal, companyId, id, b.step, b.notes); return { ok: true }; }, 201);
  });
  app.post('/companies/:companyId/nonconformities/:id/close', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ notes: z.string().min(5).max(4000) }).parse(req.body);
    return mutate(req, reply, companyId, async tx => { await closeNonconformity(tx, req.principal, companyId, id, b.notes); return { ok: true }; });
  });

  // ── Indicators and audit ──
  const periodQuery = z.object({ siteId: uuid.optional(), from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) });
  app.get('/companies/:companyId/indicators', async req => {
    const companyId = company(req);
    const q = periodQuery.parse(req.query);
    return db.tenant(companyId, tx => indicators(tx, req.principal, companyId, q));
  });
  app.get('/companies/:companyId/audit-export', async req => {
    const companyId = company(req);
    const q = periodQuery.parse(req.query);
    return db.tenant(companyId, tx => auditExport(tx, store, req.principal, companyId, q));
  });
  app.get('/companies/:companyId/audit-chain/verify', async req => {
    const companyId = company(req);
    if (!can(req.principal, 'audit.verify', { companyId }).ok) throw forbidden();
    return db.tenant(companyId, tx => verifyCompanyChain(tx, companyId));
  });

  // ── Rules (platform) ──
  const rvId = (req: FastifyRequest) => z.object({ id: uuid }).parse(req.params).id;
  app.get('/admin/rule-versions', async req => {
    platformGate(req);
    const { status } = z.object({ status: z.enum(['draft', 'in_review', 'approved', 'published', 'retired']).optional() }).parse(req.query);
    return db.system(tx => listRuleVersions(tx, req.principal, status));
  });
  app.post('/admin/rule-versions/:id/area-review', async req => {
    platformGate(req);
    const b = z.object({ area: z.string(), decision: z.enum(['approved', 'changes_requested']), notes: z.string().max(4000) }).parse(req.body);
    await db.system(tx => areaReview(tx, req.principal, rvId(req), b.area, b.decision, b.notes));
    return { ok: true };
  });
  app.post('/admin/rule-versions', async (req, reply) => {
    platformGate(req);
    const b = draftSchema.parse(req.body);
    return reply.code(201).send(await db.system(tx => createDraft(tx, req.principal, b)));
  });
  app.post('/admin/rule-versions/:id/submit', async req => { platformGate(req); await db.system(tx => submitForReview(tx, req.principal, rvId(req))); return { ok: true }; });
  app.post('/admin/rule-versions/:id/approve', async req => { platformGate(req); await db.system(tx => approve(tx, req.principal, rvId(req))); return { ok: true }; });
  app.get('/admin/rule-versions/:id/impact', async req => { platformGate(req); return db.system(tx => previewImpact(tx, req.principal, rvId(req))); });
  app.post('/admin/rule-versions/:id/publish', async req => { platformGate(req); return db.system(tx => publish(tx, req.principal, rvId(req), { allowExampleRules: config.allowExampleRules })); });

  // ── Marketplace: categories and public profiles ──
  app.get('/service-categories', async () => db.system(async tx => (await tx.query(`SELECT * FROM service_categories ORDER BY name`)).rows));
  app.get('/professionals/:id', async req => db.system(tx => mk.profileView(tx, z.object({ id: uuid }).parse(req.params).id)));

  // ── Marketplace: provider side ──
  app.get('/pro/profile', async req => db.system(async tx => {
    const pr = (await tx.query(`SELECT id FROM professional_profiles WHERE user_id = $1`, [req.principal.userId])).rows[0];
    return pr ? mk.profileView(tx, pr.id) : null;
  }));
  app.post('/pro/profile', async req => {
    const b = z.object({ kind: z.enum(['individual', 'company']), displayName: z.string().trim().min(2).max(120), headline: z.string().max(200).default(''),
      city: z.string().trim().min(2).max(60), district: z.string().max(60).nullable().optional(), bio: z.string().max(2000).default('') }).parse(req.body);
    return db.system(tx => mk.upsertProfile(tx, req.principal, b));
  });
  app.post('/pro/verifications', async (req, reply) => {
    const b = z.object({ kind: z.enum(['identity', 'business_registration', 'credential']), credentialType: z.string().regex(/^[a-z_]+$/).nullable().optional(),
      issuer: z.string().trim().min(2).max(200), documentRef: z.string().trim().min(2).max(200), scopeNote: z.string().max(500).nullable().optional(),
      validUntil: z.iso.date().nullable().optional() }).parse(req.body);
    return reply.code(201).send(await db.system(tx => mk.submitVerification(tx, req.principal, b)));
  });
  app.post('/pro/authorizations', async (req, reply) => {
    const { categoryCode } = z.object({ categoryCode: z.string() }).parse(req.body);
    return reply.code(201).send(await db.system(tx => mk.requestAuthorization(tx, req.principal, categoryCode)));
  });
  app.get('/pro/inbox', async req => db.system(tx => mk.providerInbox(tx, req.principal)));
  app.post('/pro/requests/:id/quotes', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ scope: z.string().trim().min(5).max(2000), exclusions: z.string().trim().min(2).max(2000), priceNet: z.number().min(0).max(10_000_000),
      vatRate: z.number().min(0).max(100), materials: z.string().max(2000), durationText: z.string().min(2).max(200), warrantyText: z.string().min(2).max(500),
      validUntil: z.iso.datetime({ offset: true }) }).parse(req.body);
    return reply.code(201).send(await db.system(tx => mk.submitQuote(tx, req.principal, id, b)));
  });
  app.post('/pro/jobs/:id/check-in', async req => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { code } = z.object({ code: z.string().max(20) }).parse(req.body);
    await db.system(tx => mk.checkIn(tx, req.principal, id, code));
    return { ok: true, note: 'Giriş kaydı yalnızca yerinde bulunmayı gösterir.' };
  });
  app.post('/pro/jobs/:id/report', async req => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { report } = z.object({ report: z.string().max(8000) }).parse(req.body);
    await db.system(tx => mk.submitReport(tx, req.principal, id, report));
    return { ok: true };
  });

  // ── Marketplace: review (platform) ──
  app.get('/admin/marketplace/queue', async req => { platformGate(req); return db.system(tx => mk.reviewQueue(tx, req.principal)); });
  app.post('/admin/marketplace/verifications/:id/decide', async req => {
    platformGate(req);
    const b = z.object({ decision: z.enum(['verified', 'rejected']), checkMethod: z.string().max(300), notes: z.string().max(2000).default('') }).parse(req.body);
    await db.system(tx => mk.decideVerification(tx, req.principal, rvId(req), b));
    return { ok: true };
  });
  app.post('/admin/marketplace/authorizations/:id/decide', async req => {
    platformGate(req);
    const b = z.object({ decision: z.enum(['approved', 'rejected', 'suspended']), reason: z.string().max(2000), validUntil: z.iso.date().nullable().optional() }).parse(req.body);
    await db.system(tx => mk.decideAuthorization(tx, req.principal, rvId(req), b));
    return { ok: true };
  });

  // ── Marketplace: business side ──
  app.get('/companies/:companyId/providers', async req => {
    company(req);
    const { category } = z.object({ category: z.string() }).parse(req.query);
    return db.system(tx => mk.providersFor(tx, category));
  });
  app.post('/companies/:companyId/service-requests', async (req, reply) => {
    const companyId = company(req);
    const b = z.object({ siteId: uuid, categoryCode: z.string(), title: z.string().trim().min(3).max(200), description: z.string().trim().min(5).max(4000),
      ncrId: uuid.nullable().optional(), city: z.string().trim().min(2).max(60), shareNcrSummary: z.boolean().default(false) }).parse(req.body);
    return mutate(req, reply, companyId, tx => mk.createRequest(tx, req.principal, companyId, b), 201);
  });
  app.get('/companies/:companyId/service-requests', async req => {
    const companyId = company(req);
    return db.tenant(companyId, tx => mk.listRequests(tx, req.principal, companyId));
  });
  app.get('/companies/:companyId/service-requests/:id', async req => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return db.tenant(companyId, tx => mk.requestDetail(tx, req.principal, companyId, id));
  });
  app.post('/companies/:companyId/quotes/:id/accept', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return mutate(req, reply, companyId, tx => mk.acceptQuote(tx, req.principal, companyId, id));
  });
  app.post('/companies/:companyId/jobs/:id/acceptance', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ accept: z.boolean(), note: z.string().max(2000) }).parse(req.body);
    return mutate(req, reply, companyId, tx => mk.acceptJob(tx, req.principal, companyId, id, b));
  });

  // ── Retention matrix ──
  app.get('/admin/retention-policies', async req => { platformGate(req); return db.system(tx => listRetention(tx, req.principal)); });
  app.post('/admin/retention-policies/:type/propose', async req => {
    platformGate(req);
    const { type } = z.object({ type: z.string() }).parse(req.params);
    const b = z.object({ periodMonths: z.number().int(), legalBasis: z.string().max(2000) }).parse(req.body);
    await db.system(tx => proposeRetention(tx, req.principal, type, b.periodMonths, b.legalBasis));
    return { ok: true };
  });
  app.post('/admin/retention-policies/:type/approve', async req => {
    platformGate(req);
    const { type } = z.object({ type: z.string() }).parse(req.params);
    await db.system(tx => approveRetention(tx, req.principal, type));
    return { ok: true };
  });

  // ── Demo ──
  // Deletes demo companies only; the database function refuses everything else.
  app.post('/admin/demo/reset', async req => {
    platformGate(req);
    if (!config.demoMode) throw forbidden('Demo sıfırlama bu ortamda kapalı.');
    if (!req.principal.platformRoles.includes('platform_admin')) throw forbidden();
    const deleted = await db.system(async tx => (await tx.query<{ n: number }>(`SELECT demo_reset() AS n`)).rows[0]!.n);
    return { deletedCompanies: deleted };
  });

  return app;
}
