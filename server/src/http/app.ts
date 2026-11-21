import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { redact } from '../ops/notify';
import type { Config } from '../config';
import type { Db, Tx } from '../db/pool';
import { AppError, forbidden, invalid, notFound } from '../domain/errors';
import { localDay } from '../domain/schedule';
import { appendAudit } from '../services/audit';
import { canonical, sha256 } from '../domain/hashchain';
import { can, type Principal } from '../domain/permissions';
import { verifyCompanyChain } from '../services/audit';
import { readContent, uploadContent } from '../services/evidence';
import { addSite, board, relate } from '../services/board';
import { bulkAssignApply, bulkAssignPreview } from '../services/bulk-assign';
import * as depth from '../services/market-depth';
import * as qr from '../services/qr';
import * as extraction from '../services/extraction';
import type { LlmConfig } from '../services/llm';
import { moduleStatus } from '../services/modules';
import * as leg from '../services/legislation';
import { ask as askAssistant } from '../services/assistant';
import * as padmin from '../services/platform-admin';
import { institutionView } from '../services/institution';
import { auditReport, renderPdf } from '../services/auditpdf';
import { suggestCategories } from '../domain/intent';
import { caseServiceLinks, linkServiceToCase } from '../services/case-links';
import { MANUAL_HAZARDS, addAction, addActionEvidence, assessCause, createManual, decideSuggestion, equipmentHistory, getNonconformity, listNonconformities, reassignmentQueue, recordStep, reopen, setAssignment, updateAction, verify } from '../services/nonconformities';
import { listNotifications, markProviderRead, markRead, providerNotifications } from '../services/notifications';
import { currentObligations, explain, overrideNotApplicable, recomputeSite, revertOverride, reviewOverride, withdrawOverrideRequest } from '../services/obligations';
import { confirmTotpSetup, listSessions, logout, revokeOtherSessions, revokeSession, startEmailLogin, startTotpSetup, verifyEmailLogin, verifyMfaLogin } from '../services/auth';
import { acceptInvitation, addMember, createCompany, listMyCompanies, listMyInvitations, setMemberStatus } from '../services/companies';
import type { Mailer } from '../services/mail';
import { loadPrincipal } from '../services/principal';
import * as mk from '../services/marketplace';
import * as docs from '../services/documents';
import * as verifiers from '../services/verifiers';
import * as training from '../services/training';
import * as net from '../services/network';
import { approveRetention, listRetention, proposeRetention } from '../services/retention';
import { currentFacts, recordFact, syncEquipmentTypes } from '../services/profile';
import { auditExport, indicators } from '../services/reporting';
import { SAMPLE_PROFILES, approve, areaReview, confirmEffective, createDraft, draftSchema, listProvisions, listRuleVersions, previewImpact, publish, ruleVersionDetail, submitForReview, updateDraft } from '../services/rules';
import { FACTS } from '../domain/facts';
import { addEvidence, assignableMembers, assignTask, completeTask, ensureDecisions, generateTasks, listTasks, recordMeasurement, selectServiceReportEvidence, taskDetail, topUpSite } from '../services/tasks';
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
export type AppConfig = Pick<Config, 'demoMode' | 'allowExampleRules' | 'maxUploadBytes' | 'mfaEncryptionKey' | 'mfaRequiredForPlatform'> & { corsOrigins?: string[]; mailProductionReady?: boolean;
  /** Addresses of the reverse proxy whose X-Forwarded-For is trusted (e.g. 127.0.0.1). Without it, every client behind the proxy shares one rate limit. */
  trustProxy?: string[];
  /** Optional language model for the assistant (llm.ts); without it the assistant answers from the sources alone. */
  llm?: LlmConfig | null;
  /** Separate test environment only (DEMO_MODE=true): sign-in and invitations are limited to this
   *  address domain (e.g. demo.goverhub.test), so no real person's address is entered there. */
  demoLoginDomain?: string };
/** Structured log sink. Lines carry route templates and status codes only — never bodies, query strings, headers or tokens. */
export type LogSink = (line: Record<string, unknown>) => void;

/** Routes that work without a session. */
const PUBLIC = new Set(['/health', '/env', '/auth/email/start', '/auth/email/verify', '/auth/mfa/verify', '/dev/outbox/latest']);

export function buildApp(deps: { db: Db; store: EvidenceStore; mailer: Mailer; config: AppConfig; log?: LogSink; legislation?: leg.LegislationConfig }) {
  docs.MAX_UPLOAD_BYTES.value = deps.config.maxUploadBytes;
  const { db, store, mailer, config } = deps;
  const log: LogSink = deps.log ?? (() => {});
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024, trustProxy: config.trustProxy?.length ? config.trustProxy : false });
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
    if (process.env.GH_DEBUG) console.error('DBGERR', err);
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

  /** Same as mutate() for work outside a business (network, provider side): a resent operation answers once. */
  async function userMutate(req: FastifyRequest, reply: FastifyReply, fn: (tx: Tx) => Promise<unknown>, status = 200) {
    const key = req.headers['idempotency-key'];
    const opKey = typeof key === 'string' && key.length >= 8 && key.length <= 128 ? key : null;
    const reqHash = sha256(canonical({ url: req.url, method: req.method, body: req.body ?? null }));
    const out = await db.system(async tx => {
      if (opKey) {
        const prev = (await tx.query(`SELECT * FROM user_operations WHERE user_id = $1 AND op_key = $2`, [req.principal.userId, opKey])).rows[0];
        if (prev) {
          if (prev.request_hash !== reqHash) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Bu işlem anahtarı farklı bir istekle kullanılmış.');
          return { replay: true, status: prev.status_code, body: prev.response };
        }
      }
      const body = await fn(tx);
      if (opKey) await tx.query(`INSERT INTO user_operations (user_id, op_key, request_hash, status_code, response) VALUES ($1,$2,$3,$4,$5)`,
        [req.principal.userId, opKey, reqHash, status, JSON.stringify(body ?? null)]);
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
    ...(config.demoMode && config.demoLoginDomain ? { demoLoginDomain: config.demoLoginDomain } : {}),
    exampleRulesAllowed: config.allowExampleRules,
    // Shown before a file is picked; the server enforces it too.
    upload: { maxBytes: config.maxUploadBytes, types: ALLOWED_MIME },
    mailTransport: mailer.kind,
    // True only after a person confirmed a real delivery through the chosen provider.
    mailProductionReady: mailer.kind === 'smtp' && config.mailProductionReady === true,
  }));

  // ── Sign-in ──
  const requireDemoAddress = (email: string) => {
    const d = config.demoMode ? config.demoLoginDomain : undefined;
    if (d && !email.trim().toLowerCase().endsWith(`@${d}`)) {
      throw invalid(`Bu test ortamında yalnızca @${d} uzantılı demo adresleri kullanılır. Gerçek bir e-posta adresi girmeyin.`);
    }
  };
  app.post('/auth/email/start', async req => {
    const { email } = z.object({ email: z.string().max(254) }).parse(req.body);
    requireDemoAddress(email);
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
    if (!config.demoMode || mailer.kind !== 'dev_outbox') throw notFound('Sayfa');
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
    requireDemoAddress(b.email);
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
      let createdTasks = 0;
      for (const s of sites) {
        const r = await recomputeSite(tx, companyId, s, req.principal.userId);
        recomputed.push({ siteId: s, ...r });
        // A check that now applies gets its tasks right away (not only at the next hourly top-up). Re-running adds nothing twice.
        if (r.changed.some(c => c.to === 'applies')) createdTasks += (await topUpSite(tx, companyId, s, 14, req.principal.userId)).created;
      }
      return { id, recomputed, createdTasks };
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
      // Per-unit checks (e.g. a fridge's temperature) exist only once the unit exists: create them now, not at the next top-up.
      const createdTasks = (await topUpSite(tx, companyId, b.siteId, 14, req.principal.userId)).created;
      return { id, createdTasks };
    }, 201);
  });

  // Edit a unit: rename, renew calibration, take out of use or back into use.
  // Taking a unit out of use cancels its open checks from today on; past records stay as they were.
  app.patch('/companies/:companyId/equipment/:id', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ name: z.string().trim().min(2).max(120).optional(), serial: z.string().max(120).nullable().optional(),
      calibratedUntil: z.iso.date().nullable().optional(), active: z.boolean().optional(),
      reason: z.string().trim().max(500).optional() }).parse(req.body);
    return mutate(req, reply, companyId, async tx => {
      const e = (await tx.query(`SELECT * FROM equipment WHERE id = $1 AND company_id = $2`, [id, companyId])).rows[0];
      if (!e || !can(req.principal, 'equipment.read', { companyId, siteId: e.site_id }).ok) throw notFound('Ekipman');
      if (!can(req.principal, 'equipment.write', { companyId, siteId: e.site_id }).ok) throw forbidden();
      const overdueKept = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks WHERE company_id = $1 AND equipment_id = $2 AND status = 'open' AND due_at < now()`,
        [companyId, id])).rows[0]!.n;
      if (b.active === false && e.active && (b.reason ?? '').length < 5) throw new AppError(422, 'INVALID', 'Kullanımdan kaldırma için gerekçe yaz (en az 5 karakter).');
      const siteTz = (await tx.query<{ timezone: string }>(`SELECT timezone FROM sites WHERE id = $1`, [e.site_id])).rows[0]!.timezone;
      const next = { name: b.name ?? e.name, serial: b.serial === undefined ? e.serial : b.serial,
        calibrated_until: b.calibratedUntil === undefined ? e.calibrated_until : b.calibratedUntil, active: b.active ?? e.active };
      await tx.query(`UPDATE equipment SET name = $3, serial = $4, calibrated_until = $5, active = $6 WHERE id = $1 AND company_id = $2`,
        [id, companyId, next.name, next.serial, next.calibrated_until, next.active]);
      let cancelledTasks = 0;
      if (e.active && !next.active) {
        // Checks whose time is still ahead are cancelled. Checks already past their time stay open
        // (shown as overdue): the delay is not erased by retiring the unit.
        cancelledTasks = (await tx.query(`UPDATE tasks SET status = 'cancelled', status_reason = $3, cancel_code = 'equipment_retired'
          WHERE company_id = $1 AND equipment_id = $2 AND status = 'open' AND due_at >= now()`,
          [companyId, id, `Ekipman kullanımdan kaldırıldı: ${b.reason}`])).rowCount ?? 0;
      }
      let createdTasks = 0;
      let restoredTasks = 0;
      if (e.active !== next.active) {
        await syncEquipmentTypes(tx, companyId, e.site_id);
        await recomputeSite(tx, companyId, e.site_id, req.principal.userId);
        if (next.active) {
          // Back in use: the checks cancelled when it was retired (still ahead in time) are reopened,
          // so no second task is created for the same period; only missing periods are generated.
          restoredTasks = (await tx.query(`UPDATE tasks t SET status = 'open', status_reason = NULL, cancel_code = NULL
            WHERE t.company_id = $1 AND t.equipment_id = $2 AND t.status = 'cancelled' AND t.cancel_code = 'equipment_retired' AND t.due_at >= now()
              AND NOT EXISTS (SELECT 1 FROM tasks o WHERE o.company_id = t.company_id AND o.site_id = t.site_id AND o.rule_id = t.rule_id
                AND o.template_code = t.template_code AND o.equipment_id = t.equipment_id AND o.period_key = t.period_key AND o.status <> 'cancelled')`,
            [companyId, id])).rowCount ?? 0;
          const now = new Date();
          await generateTasks(tx, companyId, e.site_id, localDay(now, siteTz), localDay(new Date(now.getTime() + 14 * 86_400_000), siteTz));
          createdTasks = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM tasks WHERE company_id = $1 AND equipment_id = $2 AND status = 'open'
              AND due_at >= now()`, [companyId, id])).rows[0]!.n;
        }
      }
      const changes: Record<string, unknown> = {};
      for (const k of ['name', 'serial', 'calibrated_until', 'active'] as const) {
        const before = e[k] instanceof Date ? (e[k] as Date).toISOString().slice(0, 10) : e[k];
        if (String(before ?? '') !== String(next[k] ?? '')) changes[k] = { from: before ?? null, to: next[k] ?? null };
      }
      await appendAudit(tx, { companyId, actorId: req.principal.userId, eventType: 'equipment.updated', entityType: 'equipment', entityId: id,
        payload: { changes, reason: b.reason ?? null, cancelledTasks, restoredTasks, overdueKept: e.active && !next.active ? overdueKept : undefined } });
      return { id, ...next, cancelledTasks, restoredTasks, openChecks: createdTasks, createdTasks, overdueKept };
    });
  });

  // What happens to this unit's checks if it is taken out of use now.
  app.get('/companies/:companyId/equipment/:id/open-checks', async req => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return db.tenant(companyId, async tx => {
      const e = (await tx.query(`SELECT site_id FROM equipment WHERE id = $1 AND company_id = $2`, [id, companyId])).rows[0];
      if (!e || !can(req.principal, 'equipment.read', { companyId, siteId: e.site_id }).ok) throw notFound('Ekipman');
      const tz = (await tx.query<{ timezone: string }>(`SELECT timezone FROM sites WHERE id = $1`, [e.site_id])).rows[0]!.timezone;
      const rows = (await tx.query(`SELECT t.id, t.due_at, t.status, tt.title, (t.due_at < now()) AS past FROM tasks t JOIN task_templates tt ON tt.id = t.template_id
         WHERE t.company_id = $1 AND t.equipment_id = $2 AND t.status = 'open' ORDER BY t.due_at`, [companyId, id])).rows;
      const today = localDay(new Date(), tz);
      return {
        overdue: rows.filter(r => r.past).length,
        upcoming: rows.filter(r => !r.past).length,
        today: rows.filter(r => localDay(new Date(r.due_at), tz) === today).map(r => ({ id: r.id, title: r.title, dueAt: r.due_at, past: r.past })),
      };
    });
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
    const b = z.object({ reason: z.string(), basis: z.string().max(2000).optional(),
      disputedFacts: z.array(z.object({ key: z.string(), proposed: z.unknown() })).max(10).optional() }).parse(req.body);
    return mutate(req, reply, companyId, tx => overrideNotApplicable(tx, req.principal, companyId, id, b.reason, { basis: b.basis, disputedFacts: b.disputedFacts }), 201);
  });
  app.post('/companies/:companyId/override-requests/:requestId/review', async (req, reply) => {
    const companyId = company(req);
    const { requestId } = z.object({ requestId: uuid }).parse(req.params);
    const b = z.object({ decision: z.enum(['approved', 'rejected']), notes: z.string().max(2000) }).parse(req.body);
    return mutate(req, reply, companyId, tx => reviewOverride(tx, req.principal, companyId, requestId, b));
  });
  app.post('/companies/:companyId/override-requests/:requestId/withdraw', async (req, reply) => {
    const companyId = company(req);
    const { requestId } = z.object({ requestId: uuid }).parse(req.params);
    return mutate(req, reply, companyId, async tx => { await withdrawOverrideRequest(tx, req.principal, companyId, requestId); return { ok: true }; });
  });
  app.post('/companies/:companyId/obligations/:id/withdraw-override', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return mutate(req, reply, companyId, async tx => {
      const r = await revertOverride(tx, req.principal, companyId, id);
      let createdTasks = 0;
      if (r.decision === 'applies') {
        // Applies again: its checks come back right away for the usual horizon.
        const tz = (await tx.query<{ timezone: string }>(`SELECT timezone FROM sites WHERE id = $1`, [r.siteId])).rows[0]!.timezone;
        const now = new Date();
        createdTasks = (await generateTasks(tx, companyId, r.siteId, localDay(now, tz), localDay(new Date(now.getTime() + 14 * 86_400_000), tz))).created;
      }
      return { id: r.id, decision: r.decision, createdTasks };
    });
  });

  // ── Tasks ──
  app.post('/companies/:companyId/tasks/generate', async (req, reply) => {
    const companyId = company(req);
    const b = z.object({ siteId: uuid, fromDay: z.iso.date(), toDay: z.iso.date() }).parse(req.body);
    if (!can(req.principal, 'task.generate', { companyId, siteId: b.siteId }).ok) throw forbidden();
    if (b.toDay < b.fromDay || (Date.parse(b.toDay) - Date.parse(b.fromDay)) / 86400000 > 62) throw new AppError(422, 'INVALID', 'Aralık en fazla 62 gün olabilir.');
    return mutate(req, reply, companyId, async tx => { await ensureDecisions(tx, companyId, b.siteId, req.principal.userId); return generateTasks(tx, companyId, b.siteId, b.fromDay, b.toDay); });
  });
  app.get('/companies/:companyId/tasks', async req => {
    const companyId = company(req);
    const q = z.object({ siteId: uuid.optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(),
      status: z.enum(['open', 'done', 'missed', 'cancelled']).optional() }).parse(req.query);
    return db.tenant(companyId, tx => listTasks(tx, req.principal, companyId, q));
  });
  // Bulk assignment: preview names the affected sites and people; apply needs the preview's count.
  const bulkScope = z.object({ userId: uuid, siteIds: z.array(uuid).max(200).optional(), templateCode: z.string().max(80).optional(),
    from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }), onlyUnassigned: z.boolean().optional() });
  app.post('/companies/:companyId/tasks/bulk-assign/preview', async req => {
    const companyId = company(req);
    const b = bulkScope.parse(req.body);
    return db.tenant(companyId, async tx => { const { taskIds: _t, ...v } = await bulkAssignPreview(tx, req.principal, companyId, b); return v; });
  });
  app.post('/companies/:companyId/tasks/bulk-assign', async (req, reply) => {
    const companyId = company(req);
    const b = bulkScope.extend({ expectedTotal: z.number().int().min(0), reason: z.string().max(500).nullable().optional() }).parse(req.body);
    return mutate(req, reply, companyId, tx => bulkAssignApply(tx, req.principal, companyId, b));
  });
  app.get('/companies/:companyId/tasks/:taskId', async req => {
    const companyId = company(req);
    const { taskId } = z.object({ taskId: uuid }).parse(req.params);
    return db.tenant(companyId, tx => taskDetail(tx, req.principal, companyId, taskId));
  });
  app.post('/companies/:companyId/tasks/:taskId/assign', async (req, reply) => {
    const companyId = company(req);
    const { taskId } = z.object({ taskId: uuid }).parse(req.params);
    const b = z.object({ userId: uuid.nullable(), applyToFuture: z.boolean().default(false) }).parse(req.body);
    return mutate(req, reply, companyId, tx => assignTask(tx, req.principal, companyId, taskId, b));
  });
  app.get('/companies/:companyId/sites/:siteId/assignees', async req => {
    const companyId = company(req);
    const { siteId } = z.object({ siteId: uuid }).parse(req.params);
    return db.tenant(companyId, tx => assignableMembers(tx, req.principal, companyId, siteId));
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
  app.get('/companies/:companyId/evidence/:evidenceId/content', async (req, reply) => {
    const companyId = company(req);
    const { evidenceId } = z.object({ evidenceId: uuid }).parse(req.params);
    const f = await readContent(db, store, req.principal, companyId, evidenceId);
    reply.header('content-type', f.mime).header('cache-control', 'private, no-store').header('x-content-sha256', f.sha256)
      .header('content-disposition', 'inline').header('x-content-type-options', 'nosniff');
    return reply.send(f.bytes);
  });
  app.post('/companies/:companyId/tasks/:taskId/report-evidence', async (req, reply) => {
    const companyId = company(req);
    const { taskId } = z.object({ taskId: uuid }).parse(req.params);
    const b = z.object({ documentId: uuid, versionId: uuid }).parse(req.body);
    return mutate(req, reply, companyId, tx => selectServiceReportEvidence(tx, req.principal, companyId, taskId, b));
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
    return db.tenant(companyId, tx => listNonconformities(tx, req.principal, companyId, status ?? null));
  });
  // A problem noticed outside a scheduled check.
  app.post('/companies/:companyId/nonconformities', async (req, reply) => {
    const companyId = company(req);
    const b = z.object({ siteId: uuid, title: z.string().trim().min(5).max(200), description: z.string().trim().min(5).max(4000),
      hazardType: z.enum(MANUAL_HAZARDS), severity: z.enum(['minor', 'major', 'critical']), equipmentId: uuid.nullable().default(null),
      containment: z.string().trim().max(4000).nullable().default(null) }).parse(req.body);
    return mutate(req, reply, companyId, tx => createManual(tx, req.principal, companyId, b), 201);
  });
  app.get('/companies/:companyId/nonconformities/:id', async req => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return db.tenant(companyId, async tx => { const n = await getNonconformity(tx, req.principal, companyId, id); return { ...n, serviceLinks: await caseServiceLinks(tx, req.principal, companyId, { id: n.id, site_id: n.siteId ?? n.site_id, equipment_id: n.equipment?.id ?? null, status: n.status }) }; });
  });
  app.post('/companies/:companyId/nonconformities/:id/steps', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ step: z.string(), notes: z.string().max(4000), measurement: z.object({ value: z.number(), unit: z.string().max(20).nullable().optional() }).nullable().optional() }).parse(req.body);
    if (b.step !== 'containment' && b.step !== 'effectiveness_check') {
      throw new AppError(422, 'STEP_MOVED', 'Düzeltme ve düzeltici faaliyet artık "aksiyon", kök neden "neden değerlendirmesi" olarak kaydediliyor. Uygulamayı güncelle.');
    }
    return mutate(req, reply, companyId, async tx => { await recordStep(tx, req.principal, companyId, id, b.step as 'containment', b.notes, b.measurement ?? null); return { ok: true }; }, 201);
  });
  app.post('/companies/:companyId/nonconformities/:id/suggestions', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ key: z.string().max(60), decision: z.enum(['dismissed', 'restored']), reason: z.string().max(1000), replacement: z.string().max(500).nullable().default(null) }).parse(req.body);
    return mutate(req, reply, companyId, tx => decideSuggestion(tx, req.principal, companyId, id, b));
  });
  app.get('/companies/:companyId/board', async req => {
    const companyId = company(req);
    const q = z.object({ siteId: uuid.optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(),
      hazard: z.string().max(60).optional(), equipmentId: uuid.optional(), ownerId: uuid.optional() }).parse(req.query);
    return db.tenant(companyId, tx => board(tx, req.principal, companyId, q));
  });
  app.post('/companies/:companyId/nonconformities/:id/relations', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ relatedId: uuid, decision: z.enum(['linked', 'unrelated']), reason: z.string().max(1000) }).parse(req.body);
    return mutate(req, reply, companyId, tx => relate(tx, req.principal, companyId, id, b), 201);
  });
  app.post('/companies/:companyId/sites', async (req, reply) => {
    const companyId = company(req);
    const b = z.object({ name: z.string().max(120) }).parse(req.body);
    return mutate(req, reply, companyId, tx => addSite(tx, req.principal, companyId, b), 201);
  });
  app.get('/companies/:companyId/equipment/:id/history', async req => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return db.tenant(companyId, tx => equipmentHistory(tx, req.principal, companyId, id));
  });
  app.post('/companies/:companyId/nonconformities/:id/assignment', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ ownerId: uuid, dueAt: z.iso.datetime({ offset: true }), reason: z.string().max(1000).nullable().default(null) }).parse(req.body);
    return mutate(req, reply, companyId, tx => setAssignment(tx, req.principal, companyId, id, b));
  });
  app.post('/companies/:companyId/nonconformities/:id/causes', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ stage: z.enum(['initial', 'verified']), categories: z.array(z.enum(['knowledge', 'equipment', 'resource', 'process'])).min(1).max(4),
      notes: z.string().max(4000) }).parse(req.body);
    return mutate(req, reply, companyId, async tx => { await assessCause(tx, req.principal, companyId, id, b); return { ok: true }; }, 201);
  });
  app.post('/companies/:companyId/nonconformities/:id/actions', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ kind: z.enum(['correction', 'corrective_action', 'follow_up']), description: z.string().max(2000),
      ownerId: uuid.nullable().default(null), dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
      supportRef: z.record(z.string(), z.unknown()).nullable().default(null), evidenceRequired: z.enum(['none', 'photo', 'document']).default('none') }).parse(req.body);
    return mutate(req, reply, companyId, tx => addAction(tx, req.principal, companyId, id, b), 201);
  });
  app.post('/companies/:companyId/nonconformities/:id/actions/:actionId', async (req, reply) => {
    const companyId = company(req);
    const { id, actionId } = z.object({ id: uuid, actionId: uuid }).parse(req.params);
    const b = z.object({ op: z.enum(['done', 'cancel', 'reassign', 'verify']), notes: z.string().max(4000).optional(), ownerId: uuid.optional(),
      dueAt: z.iso.datetime({ offset: true }).nullable().optional(), result: z.enum(['accepted', 'rejected']).optional(),
      performedBy: uuid.nullable().optional(), selfVerify: z.boolean().optional() }).parse(req.body);
    return mutate(req, reply, companyId, async tx => { await updateAction(tx, req.principal, companyId, id, actionId, b); return { ok: true }; });
  });
  app.post('/companies/:companyId/nonconformities/:id/actions/:actionId/evidence', async (req, reply) => {
    const companyId = company(req);
    const { id, actionId } = z.object({ id: uuid, actionId: uuid }).parse(req.params);
    const b = z.object({ kind: z.enum(['photo', 'document']), mime: z.string(), sha256: z.string(), sizeBytes: z.number().int().positive().max(config.maxUploadBytes) }).parse(req.body);
    return mutate(req, reply, companyId, tx => addActionEvidence(tx, req.principal, companyId, id, actionId, b), 201);
  });
  app.post('/companies/:companyId/nonconformities/:id/verify', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ result: z.enum(['effective', 'not_effective']), notes: z.string().max(4000), selfVerify: z.boolean().optional() }).parse(req.body);
    return mutate(req, reply, companyId, tx => verify(tx, req.principal, companyId, id, b));
  });
  // Older app versions: "verify and close".
  app.post('/companies/:companyId/nonconformities/:id/close', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ notes: z.string().min(5).max(4000) }).parse(req.body);
    return mutate(req, reply, companyId, tx => verify(tx, req.principal, companyId, id, { result: 'effective', notes: b.notes }));
  });
  app.post('/companies/:companyId/nonconformities/:id/reopen', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ reason: z.string().max(4000) }).parse(req.body);
    return mutate(req, reply, companyId, async tx => { await reopen(tx, req.principal, companyId, id, b.reason); return { ok: true }; });
  });
  // ── Outside verifiers (limited, time-boxed, revocable) and what is waiting for verification ──
  app.get('/companies/:companyId/verifiers', async req => {
    const companyId = company(req);
    return db.tenant(companyId, tx => verifiers.listVerifiers(tx, req.principal, companyId));
  });
  app.post('/companies/:companyId/verifiers', async (req, reply) => {
    const companyId = company(req);
    const b = z.object({ email: z.string().max(200), siteId: uuid.nullable().default(null), days: z.number().int(), note: z.string().max(500), documents: z.boolean().default(false),
      ncrIds: z.array(uuid).max(20).nullable().default(null) }).parse(req.body);
    return mutate(req, reply, companyId, tx => verifiers.inviteVerifier(tx, req.principal, companyId, b), 201);
  });
  app.post('/companies/:companyId/verifiers/:grantId/revoke', async (req, reply) => {
    const companyId = company(req);
    const { grantId } = z.object({ grantId: uuid }).parse(req.params);
    return mutate(req, reply, companyId, tx => verifiers.revokeVerifier(tx, req.principal, companyId, grantId));
  });
  app.get('/companies/:companyId/verification-queue', async req => {
    const companyId = company(req);
    return db.tenant(companyId, tx => verifiers.verificationQueue(tx, req.principal, companyId));
  });
  app.get('/companies/:companyId/reassignment-queue', async req => {
    const companyId = company(req);
    return db.tenant(companyId, tx => reassignmentQueue(tx, req.principal, companyId));
  });

  // ── In-app notifications ──
  app.get('/companies/:companyId/notifications', async req => {
    const companyId = company(req);
    return db.tenant(companyId, tx => listNotifications(tx, req.principal, companyId));
  });
  app.post('/companies/:companyId/notifications/read', async req => {
    const companyId = company(req);
    const b = z.object({ ids: z.union([z.array(uuid).max(200), z.literal('all')]) }).parse(req.body);
    return db.tenant(companyId, tx => markRead(tx, req.principal, companyId, b.ids));
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
  app.get('/admin/rule-versions/:id', async req => { platformGate(req); return db.system(tx => ruleVersionDetail(tx, req.principal, rvId(req))); });
  app.put('/admin/rule-versions/:id', async req => {
    platformGate(req);
    const b = draftSchema.parse(req.body);
    return db.system(tx => updateDraft(tx, req.principal, rvId(req), b));
  });
  app.get('/admin/provisions', async req => { platformGate(req); return db.system(tx => listProvisions(tx, req.principal)); });
  app.get('/admin/sample-profiles', async req => { platformGate(req); return SAMPLE_PROFILES; });
  // Institution view: synthetic demo only (no business data is read).
  app.get('/institution/demo', async req => {
    if (!req.principal.platformRoles.length && !config.demoMode) throw forbidden();
    const q = z.object({ region: z.string().max(60).optional(), type: z.string().max(60).optional() }).parse(req.query);
    return institutionView(q);
  });
  app.post('/admin/rule-versions/:id/confirm-effective', async req => { platformGate(req); return db.system(tx => confirmEffective(tx, req.principal, rvId(req), (req.body ?? {}) as Record<string, unknown>)); });
  app.post('/admin/rule-versions/:id/submit', async req => { platformGate(req); await db.system(tx => submitForReview(tx, req.principal, rvId(req))); return { ok: true }; });
  app.post('/admin/rule-versions/:id/approve', async req => { platformGate(req); const b = z.object({ reason: z.string().max(1000).nullable().optional() }).parse(req.body ?? {}); await db.system(tx => approve(tx, req.principal, rvId(req), b.reason)); return { ok: true }; });
  app.get('/admin/rule-versions/:id/impact', async req => { platformGate(req); return db.system(tx => previewImpact(tx, req.principal, rvId(req))); });
  app.post('/admin/rule-versions/:id/publish', async req => { platformGate(req); const b = z.object({ reason: z.string().max(1000).nullable().optional() }).parse(req.body ?? {}); return db.system(tx => publish(tx, req.principal, rvId(req), { allowExampleRules: config.allowExampleRules, reason: b.reason })); });

  // ── Legislation watch: daily scan, review queue, approval, scheduled application (platform) ──
  const legCfg = () => deps.legislation ?? leg.legislationConfig(process.env, { allowExampleRules: config.allowExampleRules });
  const reasonBody = z.object({ reason: z.string().max(2000).nullable().optional() });
  app.get('/admin/legislation/overview', async req => { platformGate(req); return db.system(tx => leg.adminOverview(tx, req.principal, legCfg())); });
  app.get('/admin/legislation/changes', async req => {
    platformGate(req);
    const { status } = z.object({ status: z.enum(['pending', 'drafted', 'scheduled', 'applied', 'rejected']).optional() }).parse(req.query);
    return db.system(tx => leg.listChanges(tx, req.principal, status));
  });
  app.get('/admin/legislation/changes/:id', async req => { platformGate(req); return db.system(tx => leg.getChange(tx, req.principal, rvId(req))); });
  app.post('/admin/legislation/scan', async req => {
    platformGate(req);
    if (!req.principal.platformRoles.includes('platform_admin') && !req.principal.platformRoles.includes('rule_reviewer')) throw forbidden('Elle tarama için yetkin yok.');
    return leg.runScan(db, legCfg(), { trigger: 'manual', actorId: req.principal.userId });
  });
  app.post('/admin/legislation/apply-due', async req => {
    platformGate(req);
    if (!req.principal.platformRoles.includes('platform_admin')) throw forbidden('Yalnız platform yöneticisi.');
    return leg.applyDue(db, legCfg());
  });
  app.post('/admin/legislation/changes/:id/resolve-date', async req => {
    platformGate(req);
    const b = z.object({ date: z.string(), note: z.string().max(2000) }).parse(req.body);
    await db.system(tx => leg.resolveDate(tx, req.principal, rvId(req), b)); return { ok: true };
  });
  app.get('/admin/legislation/changes/:id/suggest', async req => {
    platformGate(req);
    const q = z.object({ targetRuleCode: z.string().max(80).optional() }).parse(req.query);
    return db.system(tx => leg.suggestProposal(tx, req.principal, rvId(req), q.targetRuleCode ?? null));
  });
  app.put('/admin/legislation/changes/:id/proposal', async req => {
    platformGate(req);
    const b = draftSchema.extend({ targetRuleCode: z.string().nullable().optional() }).parse(req.body);
    await db.system(tx => leg.saveProposal(tx, req.principal, rvId(req), b as never)); return { ok: true };
  });
  app.post('/admin/legislation/changes/:id/prepare', async req => { platformGate(req); return db.system(tx => leg.prepareDraft(tx, req.principal, rvId(req))); });
  app.post('/admin/legislation/changes/:id/approve', async req => {
    platformGate(req);
    const b = reasonBody.parse(req.body ?? {});
    return db.system(tx => leg.approveChange(tx, req.principal, rvId(req), b.reason, legCfg()));
  });
  app.post('/admin/legislation/changes/:id/reject', async req => {
    platformGate(req);
    const b = reasonBody.parse(req.body ?? {});
    await db.system(tx => leg.reject(tx, req.principal, rvId(req), b.reason)); return { ok: true };
  });
  app.get('/companies/:companyId/legislation-changes/:id', async req => {
    const companyId = company(req);
    return db.tenant(companyId, tx => leg.businessView(tx, req.principal, companyId, rvId(req)));
  });

  // ── Platform administration: overview, audit trail, platform roles ──
  app.get('/admin/overview', async req => { platformGate(req); return db.system(tx => padmin.overview(tx, req.principal)); });
  app.get('/admin/audit', async req => {
    platformGate(req);
    const q = z.object({ companyId: uuid.optional(), scope: z.enum(['platform', 'all']).optional(), eventType: z.string().max(60).optional(), actorId: uuid.optional(),
      before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).parse(req.query);
    return db.system(tx => padmin.listAudit(tx, req.principal, q));
  });
  app.get('/admin/platform-users', async req => { platformGate(req); const { q } = z.object({ q: z.string().max(80).optional() }).parse(req.query); return db.system(tx => padmin.listPlatformUsers(tx, req.principal, q)); });
  app.post('/admin/platform-roles', async req => {
    platformGate(req);
    const b = z.object({ userId: uuid, role: z.enum(['rule_author', 'rule_reviewer', 'platform_admin', 'marketplace_reviewer', 'network_moderator']), grant: z.boolean(), reason: z.string().max(500) }).parse(req.body);
    return db.system(tx => padmin.setPlatformRole(tx, req.principal, b));
  });

  // ── Marketplace: categories and public profiles ──
  app.get('/service-categories', async () => db.system(async tx => (await tx.query(`SELECT * FROM service_categories ORDER BY name`)).rows));
  app.get('/service-categories/suggest', async req => {
    const { text } = z.object({ text: z.string().max(500).default('') }).parse(req.query);
    const names = await db.system(async tx => Object.fromEntries((await tx.query(`SELECT code, name FROM service_categories`)).rows.map(r => [r.code, r.name])));
    return { suggestions: suggestCategories(text, names), note: 'Öneri, yazdığın kelimelere dayanır; teşhis değildir. Uygun değilse başka kategori seç.' };
  });
  app.get('/professionals/:id', async req => db.system(tx => mk.profileView(tx, z.object({ id: uuid }).parse(req.params).id)));

  // ── Marketplace: provider side ──
  app.get('/pro/profile', async req => db.system(async tx => {
    const pr = (await tx.query(`SELECT id FROM professional_profiles WHERE user_id = $1`, [req.principal.userId])).rows[0];
    return pr ? mk.profileView(tx, pr.id) : null;
  }));
  app.get('/pro/notifications', async req => db.system(tx => providerNotifications(tx, req.principal)));
  app.post('/pro/notifications/read', async req => {
    const b = z.object({ ids: z.union([z.literal('all'), z.array(uuid).max(200)]) }).parse(req.body);
    return db.system(tx => markProviderRead(tx, req.principal, b.ids));
  });
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
      validUntil: z.iso.datetime({ offset: true }), deliverable: z.string().trim().min(3).max(1000) }).parse(req.body);
    return userMutate(req, reply, tx => mk.submitQuote(tx, req.principal, id, b), 201);
  });
  app.post('/pro/jobs/:id/check-in', async req => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { code } = z.object({ code: z.string().max(20) }).parse(req.body);
    await db.system(tx => mk.checkIn(tx, req.principal, id, code));
    return { ok: true, note: 'Giriş kaydı yalnızca yerinde bulunmayı gösterir.' };
  });
  app.post('/pro/jobs/:id/report', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { report, file } = z.object({ report: z.string().max(8000),
      file: z.object({ mime: z.string(), sha256: z.string(), sizeBytes: z.number().int().positive().max(config.maxUploadBytes) }).nullable().optional() }).parse(req.body);
    return userMutate(req, reply, tx => mk.submitReport(tx, req.principal, id, report, file ?? null));
  });
  // The expert's file for the report they registered: same hash/type checks as every evidence file; never readable by anyone outside the business.
  app.put('/pro/jobs/:id/report/:evidenceId/content', async req => {
    const { id, evidenceId } = z.object({ id: uuid, evidenceId: uuid }).parse(req.params);
    if (!Buffer.isBuffer(req.body)) throw new AppError(415, 'UNSUPPORTED_MEDIA', `Dosya gövdesi şu türlerden biri olmalı: ${ALLOWED_MIME.join(', ')}`);
    const companyId = await db.system(tx => mk.reportEvidenceCompany(tx, req.principal, id, evidenceId));
    return uploadContent(db, store, req.principal, companyId, evidenceId, req.body);
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
    const q = z.object({ category: z.string(), q: z.string().max(100).optional(), city: z.string().max(60).optional(), district: z.string().max(60).optional(),
      minCredentials: z.coerce.number().int().min(0).max(10).optional(), reviewedOnly: z.enum(['true', 'false']).optional() }).parse(req.query);
    return db.system(tx => mk.providersFor(tx, q.category, { ...q, reviewedOnly: q.reviewedOnly === 'true' }));
  });
  app.post('/companies/:companyId/service-requests', async (req, reply) => {
    const companyId = company(req);
    const b = z.object({ siteId: uuid, categoryCode: z.string(), title: z.string().trim().min(3).max(200), description: z.string().trim().min(5).max(4000),
      ncrId: uuid.nullable().optional(), taskId: uuid.nullable().optional(), city: z.string().trim().min(2).max(60), shareNcrSummary: z.boolean().default(false),
      invitedProfileId: uuid.nullable().default(null), invitedProfileIds: z.array(uuid).max(5).default([]) }).parse(req.body);
    return mutate(req, reply, companyId, tx => mk.createRequest(tx, req.principal, companyId, b), 201);
  });
  // Appointments (both sides) and request-linked messages.
  const apptBody = z.object({ startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }), note: z.string().max(500).nullable().optional() });
  app.get('/companies/:companyId/jobs/:jobId/appointments', async req => {
    const companyId = company(req);
    const { jobId } = z.object({ jobId: uuid }).parse(req.params);
    return db.tenant(companyId, tx => depth.jobAppointments(tx, req.principal, jobId));
  });
  app.post('/companies/:companyId/jobs/:jobId/appointments', async (req, reply) => {
    const companyId = company(req);
    const { jobId } = z.object({ jobId: uuid }).parse(req.params);
    return mutate(req, reply, companyId, tx => depth.proposeAppointment(tx, req.principal, jobId, apptBody.parse(req.body)), 201);
  });
  app.post('/companies/:companyId/appointments/:id/decision', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ accept: z.boolean(), reason: z.string().max(500).nullable().optional() }).parse(req.body);
    return mutate(req, reply, companyId, tx => depth.decideAppointment(tx, req.principal, id, b));
  });
  app.post('/companies/:companyId/appointments/:id/cancel', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ reason: z.string().max(500) }).parse(req.body);
    return mutate(req, reply, companyId, tx => depth.cancelAppointment(tx, req.principal, id, b.reason));
  });
  app.get('/companies/:companyId/service-requests/:id/messages', async req => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { profileId } = z.object({ profileId: uuid }).parse(req.query);
    return db.tenant(companyId, tx => depth.businessThread(tx, req.principal, companyId, id, profileId));
  });
  app.post('/companies/:companyId/service-requests/:id/messages', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ profileId: uuid, body: z.string().max(2000) }).parse(req.body);
    return mutate(req, reply, companyId, tx => depth.businessSend(tx, req.principal, companyId, id, b.profileId, b.body), 201);
  });
  // Provider side (system mode: every query filters by the provider's own profile).
  app.get('/pro/calendar', async req => {
    const q = z.object({ from: z.iso.datetime({ offset: true }).default(() => new Date().toISOString()), to: z.iso.datetime({ offset: true }).default(() => new Date(Date.now() + 60 * 864e5).toISOString()) }).parse(req.query);
    return db.system(tx => depth.providerCalendar(tx, req.principal, q));
  });
  app.get('/pro/jobs/:jobId/appointments', async req => db.system(tx => depth.jobAppointments(tx, req.principal, z.object({ jobId: uuid }).parse(req.params).jobId)));
  app.post('/pro/jobs/:jobId/appointments', async (req, reply) => {
    const { jobId } = z.object({ jobId: uuid }).parse(req.params);
    return userMutate(req, reply, tx => depth.proposeAppointment(tx, req.principal, jobId, apptBody.parse(req.body)), 201);
  });
  app.post('/pro/appointments/:id/decision', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ accept: z.boolean(), reason: z.string().max(500).nullable().optional() }).parse(req.body);
    return userMutate(req, reply, tx => depth.decideAppointment(tx, req.principal, id, b));
  });
  app.post('/pro/appointments/:id/cancel', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return userMutate(req, reply, tx => depth.cancelAppointment(tx, req.principal, id, z.object({ reason: z.string().max(500) }).parse(req.body).reason));
  });
  app.get('/pro/requests/:id/messages', async req => db.system(tx => depth.providerThread(tx, req.principal, z.object({ id: uuid }).parse(req.params).id)));
  app.post('/pro/requests/:id/messages', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return userMutate(req, reply, tx => depth.providerSend(tx, req.principal, id, z.object({ body: z.string().max(2000) }).parse(req.body).body), 201);
  });
  // ── QR codes bound to records; a scan is checked against the scanner's own rights on the server ──
  const baseUrl = z.string().max(200).regex(/^https?:\/\/[^\s]+$/);
  app.post('/companies/:companyId/qr', async (req, reply) => {
    const companyId = company(req);
    const b = z.object({ kind: z.enum(['equipment', 'document', 'site']), refId: uuid, label: z.string().max(120).nullable().optional() }).parse(req.body);
    return mutate(req, reply, companyId, tx => qr.createQr(tx, req.principal, companyId, b), 201);
  });
  app.get('/companies/:companyId/qr', async req => {
    const companyId = company(req);
    const q = z.object({ kind: z.enum(['equipment', 'document', 'site']).optional(), refId: uuid.optional() }).parse(req.query);
    return db.tenant(companyId, tx => qr.listQr(tx, req.principal, companyId, q));
  });
  app.post('/companies/:companyId/qr/:id/active', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ active: z.boolean(), reason: z.string().max(300).nullable().optional() }).parse(req.body);
    return mutate(req, reply, companyId, tx => qr.setQrActive(tx, req.principal, companyId, id, b));
  });
  app.get('/companies/:companyId/qr/:id/image', async req => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { base } = z.object({ base: baseUrl }).parse(req.query);
    return db.tenant(companyId, tx => qr.qrImage(tx, req.principal, companyId, id, base));
  });
  app.get('/qr/resolve', async req => {
    const { token } = z.object({ token: z.string().min(20).max(80).regex(/^[A-Za-z0-9_-]+$/) }).parse(req.query);
    return db.system(tx => qr.resolveQr(tx, req.principal, token));
  });

  // ── Reading fields from document text: proposals a person reviews and confirms ──
  app.get('/ocr/status', async () => extraction.ocrStatus());
  app.get('/system/modules', async () => moduleStatus(config.llm ?? null));
  app.get('/companies/:companyId/documents/:id/extractions', async req => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return db.tenant(companyId, tx => extraction.listExtractions(tx, req.principal, companyId, id));
  });
  app.post('/companies/:companyId/documents/:id/versions/:versionId/extractions', async (req, reply) => {
    const companyId = company(req);
    const { id, versionId } = z.object({ id: uuid, versionId: uuid }).parse(req.params);
    const b = z.object({ text: z.string().max(20000), source: z.enum(['device_text', 'typed_text']).default('typed_text') }).parse(req.body);
    return mutate(req, reply, companyId, tx => extraction.createExtraction(tx, req.principal, companyId, id, versionId, b), 201);
  });
  // Reads the version's stored file (PDF text layer, scan or photo). The reading runs outside the transaction; the result is a pending proposal.
  app.post('/companies/:companyId/documents/:id/versions/:versionId/extract-file', async (req, reply) => {
    const companyId = company(req);
    const { id, versionId } = z.object({ id: uuid, versionId: uuid }).parse(req.params);
    const out = await extraction.extractFromFile(db, store, req.principal, companyId, id, versionId);
    return reply.code(out.reused ? 200 : 201).send(out);
  });
  app.post('/companies/:companyId/extractions/:id/decision', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
    const b = z.object({ confirm: z.boolean(), fields: z.object({ docType: z.string().max(40).nullable().optional(), issuer: z.string().max(200).nullable().optional(),
      documentNo: z.string().max(100).nullable().optional(), validFrom: date, validUntil: date }).optional() }).parse(req.body);
    return mutate(req, reply, companyId, tx => extraction.decideExtraction(tx, req.principal, companyId, id, b));
  });

  // ── Assistant: answers only from this business's own records and published rules; says so when the sources fall short ──
  app.post('/companies/:companyId/assistant/ask', async req => {
    const companyId = company(req);
    const b = z.object({ question: z.string().max(600), siteId: uuid.nullable().optional() }).parse(req.body);
    return askAssistant(db, config.llm ?? null, req.principal, companyId, b);
  });
  app.post('/companies/:companyId/service-requests/preview', async req => {
    const companyId = company(req);
    const b = z.object({ siteId: uuid, categoryCode: z.string(), title: z.string().max(200), description: z.string().max(4000), city: z.string().max(60),
      ncrId: uuid.nullable().optional(), shareNcrSummary: z.boolean().default(false), invitedProfileId: uuid.nullable().default(null), invitedProfileIds: z.array(uuid).max(5).default([]) }).parse(req.body);
    return db.tenant(companyId, tx => mk.requestPreview(tx, req.principal, companyId, b));
  });
  app.post('/companies/:companyId/service-requests/:id/cancel', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ reason: z.string().max(1000) }).parse(req.body);
    return mutate(req, reply, companyId, tx => mk.cancelService(tx, req.principal, companyId, id, b.reason));
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
  // Review of a delivered and accepted job (one per job; shown on the provider profile only if allowed).
  app.post('/companies/:companyId/jobs/:id/review', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const star = z.number().int().min(1).max(5);
    const b = z.object({ quality: star, timeliness: star, communication: star, comment: z.string().max(1000).nullable().default(null),
      showOnProfile: z.boolean().default(false) }).parse(req.body);
    return mutate(req, reply, companyId, tx => mk.reviewJob(tx, req.principal, companyId, id, b), 201);
  });

  // ── Professional network (signed-in users with a network profile) ──
  app.get('/network/me', async req => db.system(async tx => {
    const pr = (await tx.query(`SELECT user_id FROM network_profiles WHERE user_id = $1`, [req.principal.userId])).rows[0];
    return { hasProfile: !!pr, specialties: net.SPECIALTIES, ...(await net.moderatorFlag(req.principal)), note: net.NETWORK_NOTE };
  }));
  app.post('/network/profile', async req => {
    const b = z.object({ displayName: z.string().max(120), title: z.string().max(120).default(''), bio: z.string().max(1500).default(''), city: z.string().max(60),
      district: z.string().max(60).nullable().default(null), specialties: z.array(z.string().max(40)).max(12).default([]), categories: z.array(z.string().max(60)).max(10).default([]),
      phone: z.string().max(30).nullable().default(null), showEmail: z.boolean().default(false), showPhone: z.boolean().default(false) }).parse(req.body);
    return db.system(tx => net.saveProfile(tx, req.principal, b));
  });
  app.put('/network/profile/photo', async req => {
    if (!Buffer.isBuffer(req.body)) throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Fotoğraf JPEG ya da PNG olmalı.');
    return net.setPhoto(db, store, req.principal, String(req.headers['content-type']).split(';')[0]!, req.body);
  });
  app.get('/network/profiles/:userId/photo', async (req, reply) => {
    const { userId } = z.object({ userId: uuid }).parse(req.params);
    const f = await net.getPhoto(db, store, req.principal, userId);
    return reply.header('content-type', f.mime).header('cache-control', 'private, max-age=300').header('x-content-type-options', 'nosniff').send(f.bytes);
  });
  app.post('/network/experience', async (req, reply) => {
    const b = z.object({ roleTitle: z.string().max(120), organization: z.string().max(120).default(''), startYear: z.number().int(), endYear: z.number().int().nullable().default(null),
      description: z.string().max(1000).default('') }).parse(req.body);
    return reply.code(201).send(await db.system(tx => net.addExperience(tx, req.principal, b)));
  });
  app.post('/network/experience/:id/delete', async req => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await db.system(tx => net.removeExperience(tx, req.principal, id)); return { ok: true };
  });
  app.get('/network/profiles/:userId', async req => db.system(tx => net.viewProfile(tx, req.principal, z.object({ userId: uuid }).parse(req.params).userId)));
  app.get('/network/search', async req => {
    const q = z.object({ text: z.string().max(100).optional(), specialty: z.string().max(40).optional(), category: z.string().max(60).optional(), city: z.string().max(60).optional(),
      approvedOnly: z.enum(['1', '0']).optional() }).parse(req.query);
    return db.system(tx => net.search(tx, req.principal, { ...q, approvedOnly: q.approvedOnly === '1' }));
  });
  app.post('/network/profiles/:userId/:op', async req => {
    const { userId, op } = z.object({ userId: uuid, op: z.enum(['follow', 'unfollow', 'block', 'unblock']) }).parse(req.params);
    return db.system(async (tx): Promise<object> => op === 'follow' || op === 'unfollow' ? net.follow(tx, req.principal, userId, op === 'follow') : net.block(tx, req.principal, userId, op === 'block'));
  });
  app.get('/network/feed', async req => {
    const q = z.object({ scope: z.enum(['all', 'following', 'mine', 'saved']).default('all'), authorId: uuid.optional() }).parse(req.query);
    return db.system(tx => net.feed(tx, req.principal, q));
  });
  app.post('/network/posts', async (req, reply) => {
    const b = z.object({ body: z.string().max(5000), publish: z.boolean().default(false) }).parse(req.body);
    return userMutate(req, reply, tx => net.createPost(tx, req.principal, b), 201);
  });
  app.get('/network/posts/:id', async req => db.system(tx => net.getPost(tx, req.principal, z.object({ id: uuid }).parse(req.params).id)));
  app.post('/network/posts/:id', async req => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ body: z.string().max(5000).optional(), op: z.enum(['publish', 'delete']).optional() }).parse(req.body);
    await db.system(tx => net.updatePost(tx, req.principal, id, b)); return { ok: true };
  });
  app.post('/network/posts/:id/reactions', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ kind: z.enum(['helpful', 'saved']), on: z.boolean() }).parse(req.body);
    return userMutate(req, reply, tx => net.react(tx, req.principal, id, b.kind, b.on));
  });
  app.post('/network/posts/:id/comments', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ body: z.string().max(2000) }).parse(req.body);
    return userMutate(req, reply, tx => net.comment(tx, req.principal, id, b.body), 201);
  });
  app.post('/network/comments/:id', async req => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ body: z.string().max(2000).optional(), op: z.literal('delete').optional() }).parse(req.body);
    await db.system(tx => net.updateComment(tx, req.principal, id, b)); return { ok: true };
  });
  app.post('/network/reports', async (req, reply) => {
    const b = z.object({ targetType: z.enum(['post', 'comment', 'profile']), targetId: uuid, reason: z.enum(['misleading', 'personal_data', 'commercial_data', 'harassment', 'spam', 'other']),
      details: z.string().max(1000).default('') }).parse(req.body);
    return userMutate(req, reply, tx => net.report(tx, req.principal, b), 201);
  });
  app.get('/network/my-reports', async req => db.system(tx => net.myReports(tx, req.principal)));
  app.get('/network/decisions-on-me', async req => db.system(tx => net.decisionsOnMe(tx, req.principal)));
  app.post('/network/reports/:id/appeal', async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ reason: z.string().max(2000) }).parse(req.body);
    return userMutate(req, reply, tx => net.appeal(tx, req.principal, id, b.reason), 201);
  });
  app.get('/network/moderation/appeals', async req => db.system(tx => net.appealQueue(tx, req.principal)));
  app.post('/network/moderation/appeals/:id', async req => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ decision: z.enum(['upheld', 'overturned']), notes: z.string().max(2000) }).parse(req.body);
    return db.system(tx => net.decideAppeal(tx, req.principal, id, b));
  });
  // Case shares seen from the business: permit the current text again, or withdraw.
  app.get('/companies/:companyId/network/case-posts', async req => {
    const companyId = company(req);
    return db.system(tx => net.businessCasePosts(tx, req.principal, companyId));
  });
  app.post('/companies/:companyId/network/case-posts/:postId/approve', async req => {
    const companyId = company(req);
    const { postId } = z.object({ postId: uuid }).parse(req.params);
    const b = z.object({ permit: z.boolean() }).parse(req.body);
    return db.system(tx => net.reapproveCase(tx, req.principal, companyId, postId, b));
  });
  app.post('/companies/:companyId/network/case-posts/:postId/withdraw', async req => {
    const companyId = company(req);
    const { postId } = z.object({ postId: uuid }).parse(req.params);
    const b = z.object({ reason: z.string().max(1000) }).parse(req.body);
    return db.system(tx => net.withdrawCase(tx, req.principal, companyId, postId, b.reason));
  });
  app.get('/network/moderation/reports', async req => {
    const q = z.object({ status: z.enum(['open', 'closed']).default('open') }).parse(req.query);
    return db.system(tx => net.moderationQueue(tx, req.principal, q.status));
  });
  app.post('/network/moderation/reports/:id', async req => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ decision: z.enum(['hide', 'dismiss', 'suspend_profile']), notes: z.string().max(2000) }).parse(req.body);
    return db.system(tx => net.decide(tx, req.principal, id, b));
  });
  // Case share: preview (nothing stored) and, with an authorised person's permission, a draft post.
  const caseBody = z.object({ fields: z.array(z.enum(net.CASE_FIELDS)).max(5), summary: z.string().max(3000) });
  app.post('/companies/:companyId/nonconformities/:id/service-links', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ jobId: uuid, basis: z.string().min(1).max(1000) }).parse(req.body);
    return mutate(req, reply, companyId, tx => linkServiceToCase(tx, req.principal, companyId, id, b), 201);
  });
  app.post('/companies/:companyId/nonconformities/:id/share-preview', async req => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = caseBody.parse(req.body);
    return db.tenant(companyId, tx => net.previewCase(tx, req.principal, companyId, id, b));
  });
  app.post('/companies/:companyId/nonconformities/:id/share', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = caseBody.extend({ permit: z.boolean() }).parse(req.body);
    return mutate(req, reply, companyId, tx => net.shareCase(tx, req.principal, companyId, id, b), 201);
  });

  // ── Training ──
  const quizQ = z.object({ q: z.string().max(300), options: z.array(z.string().max(200)).max(5), answer: z.number().int() });
  const courseBody = z.object({ title: z.string().max(200), summary: z.string().max(500).default(''), body: z.string().max(20000), videoUrl: z.string().max(500).nullable().default(null),
    quiz: z.array(quizQ).max(10).default([]), passScore: z.number().int().min(1).max(100).default(80), minutes: z.number().int().min(1).max(600).nullable().default(null),
    links: z.array(z.object({ kind: z.enum(['task_template', 'rule', 'hazard']), ref: z.string().max(100) })).max(20).default([]) });
  app.get('/companies/:companyId/training/courses', async req => {
    const companyId = company(req);
    return db.tenant(companyId, tx => training.listCourses(tx, req.principal, companyId));
  });
  app.post('/companies/:companyId/training/courses', async (req, reply) => {
    const companyId = company(req);
    const b = courseBody.parse(req.body);
    return mutate(req, reply, companyId, tx => training.createCourse(tx, req.principal, companyId, b), 201);
  });
  app.get('/companies/:companyId/training/courses/:id', async req => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return db.tenant(companyId, tx => training.getCourse(tx, req.principal, companyId, id));
  });
  app.post('/companies/:companyId/training/courses/:id/new-version', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return mutate(req, reply, companyId, tx => training.newVersion(tx, req.principal, companyId, id), 201);
  });
  app.post('/companies/:companyId/training/courses/:id/archive', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return mutate(req, reply, companyId, async tx => { await training.archiveCourse(tx, req.principal, companyId, id); return { ok: true }; });
  });
  app.post('/companies/:companyId/training/versions/:id', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = courseBody.parse(req.body);
    return mutate(req, reply, companyId, async tx => { await training.updateDraft(tx, req.principal, companyId, id, b); return { ok: true }; });
  });
  app.post('/companies/:companyId/training/versions/:id/:op', async (req, reply) => {
    const companyId = company(req);
    const { id, op } = z.object({ id: uuid, op: z.enum(['submit', 'reject', 'publish']) }).parse(req.params);
    const b = z.object({ notes: z.string().max(2000).nullable().default(null) }).parse(req.body ?? {});
    return mutate(req, reply, companyId, async tx => { await training.changeStatus(tx, req.principal, companyId, id, op, b.notes); return { ok: true }; });
  });
  app.get('/companies/:companyId/training/assignments', async req => {
    const companyId = company(req);
    const q = z.object({ scope: z.enum(['mine', 'managed']).default('mine'), ncrId: uuid.optional() }).parse(req.query);
    return db.tenant(companyId, tx => training.listAssignments(tx, req.principal, companyId, q.scope, q.ncrId ?? null));
  });
  app.post('/companies/:companyId/training/assignments', async (req, reply) => {
    const companyId = company(req);
    const b = z.object({ courseId: uuid, userId: uuid, siteId: uuid, dueAt: z.iso.datetime({ offset: true }).nullable().default(null), reason: z.string().max(1000),
      ncrId: uuid.nullable().default(null), actionId: uuid.nullable().default(null) }).parse(req.body);
    return mutate(req, reply, companyId, tx => training.assign(tx, req.principal, companyId, b), 201);
  });
  app.get('/companies/:companyId/training/assignments/:id', async req => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return db.tenant(companyId, tx => training.getAssignment(tx, req.principal, companyId, id));
  });
  app.post('/companies/:companyId/training/assignments/:id/:step', async (req, reply) => {
    const companyId = company(req);
    const { id, step } = z.object({ id: uuid, step: z.enum(['read', 'complete', 'attempt', 'field-verify', 'cancel', 'due', 'retrain']) }).parse(req.params);
    return mutate(req, reply, companyId, async tx => {
      if (step === 'due' || step === 'retrain') {
        const b = z.object({ dueAt: z.iso.datetime({ offset: true }).nullable().default(null), reason: z.string().max(1000) }).parse(req.body);
        return step === 'due' ? (await training.changeDue(tx, req.principal, companyId, id, b), { ok: true }) : training.retrain(tx, req.principal, companyId, id, b);
      }
      if (step === 'read' || step === 'complete') return training.learnerStep(tx, req.principal, companyId, id, step);
      if (step === 'attempt') return training.attempt(tx, req.principal, companyId, id, z.object({ answers: z.array(z.number().int()).max(10) }).parse(req.body).answers);
      if (step === 'field-verify') return training.fieldVerify(tx, req.principal, companyId, id,
        z.object({ result: z.enum(['effective', 'not_effective']), notes: z.string().max(2000), actionId: uuid.nullable().default(null) }).parse(req.body));
      await training.cancelAssignment(tx, req.principal, companyId, id, z.object({ reason: z.string().max(1000) }).parse(req.body).reason);
      return { ok: true };
    });
  });

  // ── Document vault ──
  const isoDate = z.iso.date().nullable();
  app.get('/companies/:companyId/documents', async req => {
    const companyId = company(req);
    const q = z.object({ siteId: uuid.optional(), equipmentId: uuid.optional(), filter: z.enum(['expiring', 'expired', 'pending_review', 'rejected', 'no_file']).optional() }).parse(req.query);
    return db.tenant(companyId, tx => docs.listDocuments(tx, req.principal, companyId, q));
  });
  app.post('/companies/:companyId/documents', async (req, reply) => {
    const companyId = company(req);
    const b = z.object({ docType: z.enum(docs.DOC_TYPES), title: z.string().max(200), siteId: uuid.nullable().default(null), equipmentId: uuid.nullable().default(null),
      issuer: z.string().max(200).nullable().default(null), documentNo: z.string().max(100).nullable().default(null) }).parse(req.body);
    return mutate(req, reply, companyId, tx => docs.createDocument(tx, req.principal, companyId, b), 201);
  });
  app.get('/companies/:companyId/documents/:id/use-choices', async req => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return db.tenant(companyId, tx => docs.useChoices(tx, req.principal, companyId, id));
  });
  app.post('/companies/:companyId/documents/:id/uses', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ op: z.enum(['add', 'remove']), kind: z.enum(['task_template', 'equipment', 'obligation']).optional(), ref: z.string().max(80).optional(),
      purpose: z.string().max(500).optional(), linkId: uuid.optional() }).parse(req.body);
    return mutate(req, reply, companyId, tx => docs.linkDocument(tx, req.principal, companyId, id, b), b.op === 'add' ? 201 : 200);
  });
  // Audit file: data (json) or PDF. linkBase: the API address as the user's app sees it, used to print attachment links.
  app.get('/companies/:companyId/audit-report', async (req, reply) => {
    const companyId = company(req);
    const q = z.object({ siteId: uuid.optional(), from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }), format: z.enum(['json', 'pdf']).default('pdf'),
      linkBase: z.string().max(200).regex(/^(https?:\/\/[^\s]+|\/[^\s]*)?$/).default('') }).parse(req.query);
    const report = await db.tenant(companyId, tx => auditReport(tx, req.principal, companyId, q));
    if (q.format === 'json') return report;
    const pdf = await renderPdf(report, q.linkBase.replace(/\/$/, ''));
    const day = new Date().toISOString().slice(0, 10);
    return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="denetim-dosyasi-${day}.pdf"`).send(pdf);
  });
  app.get('/companies/:companyId/training/courses/:id/people', async req => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return db.tenant(companyId, tx => training.coursePeople(tx, req.principal, companyId, id));
  });
  app.get('/companies/:companyId/documents/:id', async req => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return db.tenant(companyId, tx => docs.getDocument(tx, req.principal, companyId, id));
  });
  app.post('/companies/:companyId/documents/:id/versions', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ validFrom: isoDate.default(null), validUntil: isoDate.default(null), notes: z.string().max(2000).nullable().default(null),
      file: z.object({ mime: z.string(), sha256: z.string(), sizeBytes: z.number().int().positive().max(config.maxUploadBytes) }) }).parse(req.body);
    return mutate(req, reply, companyId, tx => docs.addVersion(tx, req.principal, companyId, id, b), 201);
  });
  app.post('/companies/:companyId/documents/:id/versions/:versionId/issuer-check', async (req, reply) => {
    const companyId = company(req);
    const { id, versionId } = z.object({ id: uuid, versionId: uuid }).parse(req.params);
    const b = z.object({ method: z.enum(docs.ISSUER_METHODS), reference: z.string().max(200), notes: z.string().max(1000).nullable().default(null) }).parse(req.body);
    return mutate(req, reply, companyId, tx => docs.recordIssuerCheck(tx, req.principal, companyId, id, versionId, b));
  });
  app.post('/companies/:companyId/documents/:id/shares', async (req, reply) => {
    const companyId = company(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ siteId: uuid, share: z.boolean() }).parse(req.body);
    return mutate(req, reply, companyId, tx => docs.shareDocument(tx, req.principal, companyId, id, b));
  });
  app.post('/companies/:companyId/documents/:id/versions/:versionId/review', async (req, reply) => {
    const companyId = company(req);
    const { id, versionId } = z.object({ id: uuid, versionId: uuid }).parse(req.params);
    const b = z.object({ decision: z.enum(['verified', 'rejected']), notes: z.string().max(2000), validFrom: isoDate.optional(), validUntil: isoDate.optional() }).parse(req.body);
    return mutate(req, reply, companyId, tx => docs.reviewVersion(tx, req.principal, companyId, id, versionId, b));
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
