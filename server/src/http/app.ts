import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config';
import type { Db, Tx } from '../db/pool';
import { AppError, forbidden, notFound } from '../domain/errors';
import { canonical, sha256 } from '../domain/hashchain';
import { can, type Principal } from '../domain/permissions';
import { verifyCompanyChain } from '../services/audit';
import { uploadContent } from '../services/evidence';
import { closeNonconformity, completeStep, getNonconformity } from '../services/nonconformities';
import { currentObligations, explain, overrideNotApplicable, recomputeSite } from '../services/obligations';
import { loadPrincipal } from '../services/principal';
import { currentFacts, recordFact, syncEquipmentTypes } from '../services/profile';
import { auditExport, indicators } from '../services/reporting';
import { approve, createDraft, draftSchema, previewImpact, publish, submitForReview } from '../services/rules';
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
export function buildApp(deps: { db: Db; store: EvidenceStore; config: Pick<Config, 'demoMode' | 'allowExampleRules' | 'maxUploadBytes'> }) {
  const { db, store, config } = deps;
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });

  for (const mime of ALLOWED_MIME) {
    app.addContentTypeParser(mime, { parseAs: 'buffer', bodyLimit: config.maxUploadBytes }, (_req, body, done) => done(null, body));
  }

  // Simple per-token rate limit; a shared store (e.g. Redis) replaces this when running several instances.
  const hits = new Map<string, { n: number; reset: number }>();
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const key = token ? sha256(token) : `ip:${req.ip}`;
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + 60_000 });
    else if (++h.n > 300) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Çok fazla istek; bir dakika sonra tekrar dene.' } });
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
    console.error(err);
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

  app.get('/health', async () => ({ ok: true }));

  app.get('/me', async req => ({
    userId: req.principal.userId, platformRoles: req.principal.platformRoles,
    memberships: req.principal.memberships, grants: req.principal.grants,
  }));

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
  app.post('/admin/rule-versions', async (req, reply) => {
    const b = draftSchema.parse(req.body);
    return reply.code(201).send(await db.system(tx => createDraft(tx, req.principal, b)));
  });
  const rvId = (req: FastifyRequest) => z.object({ id: uuid }).parse(req.params).id;
  app.post('/admin/rule-versions/:id/submit', async req => { await db.system(tx => submitForReview(tx, req.principal, rvId(req))); return { ok: true }; });
  app.post('/admin/rule-versions/:id/approve', async req => { await db.system(tx => approve(tx, req.principal, rvId(req))); return { ok: true }; });
  app.get('/admin/rule-versions/:id/impact', async req => db.system(tx => previewImpact(tx, req.principal, rvId(req))));
  app.post('/admin/rule-versions/:id/publish', async req => db.system(tx => publish(tx, req.principal, rvId(req), { allowExampleRules: config.allowExampleRules })));

  // ── Demo ──
  // Deletes demo companies only; the database function refuses everything else.
  app.post('/admin/demo/reset', async req => {
    if (!config.demoMode) throw forbidden('Demo sıfırlama bu ortamda kapalı.');
    if (!req.principal.platformRoles.includes('platform_admin')) throw forbidden();
    const deleted = await db.system(async tx => (await tx.query<{ n: number }>(`SELECT demo_reset() AS n`)).rows[0]!.n);
    return { deletedCompanies: deleted };
  });

  return app;
}
