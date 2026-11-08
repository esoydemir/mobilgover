import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDay } from '../../src/domain/schedule';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { client, fakeJpeg, freshEnv, type Env } from '../support/env';

/**
 * End-to-end slice: profile → approved rule → applicability explanation →
 * task → evidence → nonconformity → action → independent verification →
 * audit export. Rules and limits are EXAMPLES (see src/seed/demo.ts).
 */
let env: Env;
let platform: Awaited<ReturnType<typeof seedPlatform>>;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const today = localDay(new Date(), 'Europe/Istanbul');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const expert = () => client(env, demo.users.expert.token);

let fridgeTaskId: string;
let ncrId: string;

beforeAll(async () => {
  env = await freshEnv();
  platform = await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
});
afterAll(async () => { await env?.close(); });

describe('applicability', () => {
  it('derives obligations from confirmed facts and asks instead of guessing', async () => {
    const r = await owner().get(`${C()}/obligations`);
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.map((o: any) => [o.rule, o]));
    expect(by['EX-COLD-CHAIN'].decision).toBe('applies');
    expect(by['EX-LPG-CHECK'].decision).toBe('applies');
    // staff.count was never answered: the ISG rule must not become "not applicable".
    expect(by['EX-ISG-THRESHOLD'].decision).toBe('needs_info');
    expect(by['EX-ISG-THRESHOLD'].missingFacts).toEqual(['staff.count']);
    expect(r.body.every((o: any) => o.isExample)).toBe(true);
  });

  it('once the missing fact arrives, an ambiguous provision goes to review, not straight to "applies"', async () => {
    const r = await owner().post(`${C()}/profile/facts`, { siteId: null, key: 'staff.count', value: 12, source: 'user_declared', verification: 'user_confirmed' });
    expect(r.status).toBe(201);
    const o = (await owner().get(`${C()}/obligations`)).body.find((x: any) => x.rule === 'EX-ISG-THRESHOLD');
    expect(o.decision).toBe('needs_review');
  });

  it('explains why an obligation applies: matched facts, provision, rule version, label', async () => {
    const o = (await owner().get(`${C()}/obligations`)).body.find((x: any) => x.rule === 'EX-COLD-CHAIN');
    const e = (await owner().get(`${C()}/obligations/${o.id}/explanation`)).body;
    expect(e.rule).toMatchObject({ code: 'EX-COLD-CHAIN', version: 1, status: 'published', isExample: true });
    expect(e.rule.label).toContain('ÖRNEK');
    expect(e.provisions[0]).toMatchObject({ ref: 'Örnek Madde 1', is_example: true });
    expect(e.matchedFacts['storage.cold']).toMatchObject({ value: true, verification: 'user_confirmed' });
    expect(e.trace.result).toBe('true');
  });

  it('unconfirmed OCR does not change obligations until a person confirms it', async () => {
    const before = (await owner().get(`${C()}/obligations`)).body.find((x: any) => x.rule === 'EX-LPG-CHECK').decision;
    await owner().post(`${C()}/profile/facts`, { siteId: demo.siteId, key: 'service.delivery', value: true, source: 'ocr', verification: 'unverified', confidence: 0.71 });
    const after = (await owner().get(`${C()}/obligations`)).body.find((x: any) => x.rule === 'EX-LPG-CHECK').decision;
    expect(after).toBe(before);
    const bad = await owner().post(`${C()}/profile/facts`, { siteId: demo.siteId, key: 'utility.lpg', value: false, source: 'ocr', verification: 'user_confirmed' });
    expect(bad.status).toBe(422);
  });

  it('a manual "does not apply" needs a reason and records who decided', async () => {
    const o = (await owner().get(`${C()}/obligations`)).body.find((x: any) => x.rule === 'EX-GLOVE');
    expect((await owner().post(`${C()}/obligations/${o.id}/not-applicable`, { reason: 'yok' })).status).toBe(422);
    expect((await staff().post(`${C()}/obligations/${o.id}/not-applicable`, { reason: 'Mutfakta eldiven yerine maşa kullanılıyor.' })).status).toBe(403);
  });
});

describe('tasks', () => {
  it('generates tasks once; running generation again creates nothing new', async () => {
    const body = { siteId: demo.siteId, fromDay: today, toDay: today };
    const a = await owner().post(`${C()}/tasks/generate`, body);
    expect(a.status).toBe(200);
    expect(a.body.created).toBeGreaterThanOrEqual(2);
    const b = await owner().post(`${C()}/tasks/generate`, body);
    expect(b.body).toMatchObject({ created: 0, existing: a.body.created });
    const tasks = (await owner().get(`${C()}/tasks?siteId=${demo.siteId}`)).body;
    fridgeTaskId = tasks.find((t: any) => t.equipment_id === demo.fridgeId).id;
    expect(fridgeTaskId).toBeTruthy();
  });

  it('staff only see tasks assigned to them', async () => {
    expect((await staff().get(`${C()}/tasks/${fridgeTaskId}`)).status).toBe(404);
    await env.ownerDb.query(`UPDATE tasks SET assignee_id = $1 WHERE id = $2`, [demo.users.staff.id, fridgeTaskId]);
    const d = await staff().get(`${C()}/tasks/${fridgeTaskId}`);
    expect(d.status).toBe(200);
    expect(d.body.emergencyInstruction).toContain('ÖRNEK TALİMAT');
    expect((await staff().get(`${C()}/tasks`)).body.map((t: any) => t.id)).toEqual([fridgeTaskId]);
    expect((await staff().get(`${C()}/indicators?from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z`)).status).toBe(403);
  });

  it('records an out-of-limit measurement honestly, with device and server time kept apart', async () => {
    const r = await staff().post(`${C()}/tasks/${fridgeTaskId}/measurements`,
      { quantity: 'temperature', value: 12, unit: '°C', measuredAt: new Date(Date.now() - 60_000).toISOString(), instrumentId: demo.thermometerId });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ withinLimit: false, calibrationStatus: 'valid', limit: { max: 4, basis: 'example' } });
    const wrongUnit = await staff().post(`${C()}/tasks/${fridgeTaskId}/measurements`, { quantity: 'temperature', value: 50, unit: '°F', measuredAt: new Date().toISOString() });
    expect(wrongUnit.body.error.code).toBe('UNIT_MISMATCH');
    const future = await staff().post(`${C()}/tasks/${fridgeTaskId}/measurements`, { quantity: 'temperature', value: 3, unit: '°C', measuredAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(future.status).toBe(422);
  });

  it('cannot be completed while mandatory evidence is missing or still uploading', async () => {
    const r1 = await staff().post(`${C()}/tasks/${fridgeTaskId}/complete`);
    expect(r1.body.error.code).toBe('EVIDENCE_INCOMPLETE');
    expect(r1.body.error.details.missing.join()).toContain('Fotoğraf');

    const photo = fakeJpeg('thermometer-12C');
    const reg = await staff().post(`${C()}/tasks/${fridgeTaskId}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: sha(photo), sizeBytes: photo.length });
    expect(reg.body.status).toBe('pending_upload');
    const r2 = await staff().post(`${C()}/tasks/${fridgeTaskId}/complete`);
    expect(r2.body.error.details.pending.length).toBe(1);

    // A truncated upload does not match the declared hash and is rejected, visibly.
    const half = await staff().put(`${C()}/evidence/${reg.body.id}/content`, photo.subarray(0, 6), 'image/jpeg');
    expect(half.body.error.code).toBe('UPLOAD_REJECTED');
    const d = (await staff().get(`${C()}/tasks/${fridgeTaskId}`)).body;
    expect(d.evidence.find((e: any) => e.id === reg.body.id).status).toBe('rejected');

    const reg2 = await staff().post(`${C()}/tasks/${fridgeTaskId}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: sha(photo), sizeBytes: photo.length });
    const ok = await staff().put(`${C()}/evidence/${reg2.body.id}/content`, photo, 'image/jpeg');
    expect(ok.body.status).toBe('stored');

    // Out of limit → a written explanation is now required too.
    const r3 = await staff().post(`${C()}/tasks/${fridgeTaskId}/complete`);
    expect(r3.body.error.details.missing).toContain('Açıklama notu');
  });

  it('completes as "done, nonconforming" and opens a risk-graded nonconformity', async () => {
    await staff().post(`${C()}/tasks/${fridgeTaskId}/evidence`, { kind: 'note', text: 'Kapı contası açık kalmış, ürünler yedek üniteye alındı.' });
    const key = { 'idempotency-key': 'device-7f3a-complete-0001' };
    const body = { clientCompletedAt: new Date().toISOString() };
    const r = await staff().post(`${C()}/tasks/${fridgeTaskId}/complete`, body, key);
    expect(r.status).toBe(200);
    expect(r.body.outcome).toBe('nonconforming');
    ncrId = r.body.nonconformityId;
    expect(ncrId).toBeTruthy();

    // The offline queue resends the same operation: same answer, no second write.
    const again = await staff().post(`${C()}/tasks/${fridgeTaskId}/complete`, body, key);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.body).toEqual(r.body);
    // The same key with a different payload is refused rather than guessed at.
    const reused = await staff().post(`${C()}/tasks/${fridgeTaskId}/complete`, { clientCompletedAt: new Date(0).toISOString() }, key);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    // Another device trying to complete it gets a visible conflict, not an overwrite.
    const other = await owner().post(`${C()}/tasks/${fridgeTaskId}/complete`, {}, { 'idempotency-key': 'device-other-0002' });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('TASK_ALREADY_DONE');
  });
});

describe('nonconformity and CAPA', () => {
  it('sizes the process by risk and shows the approved emergency instruction', async () => {
    const n = (await owner().get(`${C()}/nonconformities/${ncrId}`)).body;
    expect(n).toMatchObject({ risk_level: 'high', depth: 'capa', status: 'open' });
    expect(n.requiredSteps).toEqual(['containment', 'correction', 'root_cause', 'corrective_action', 'effectiveness_check']);
    expect(n.emergency_instruction).toContain('ÖRNEK TALİMAT');
  });

  it('follows the flow: first response, owner and due date, cause, actions, verified root cause, effectiveness check', async () => {
    const N = `${C()}/nonconformities/${ncrId}`;
    // Old step names are refused with a clear message (they are actions and cause assessments now).
    expect((await manager().post(`${N}/steps`, { step: 'correction', notes: 'Termostat ayarlandı.' })).body.error.code).toBe('STEP_MOVED');
    const early = await manager().post(`${N}/steps`, { step: 'effectiveness_check', notes: '3 gün ölçüm.' });
    expect(early.body.error.code).toBe('FLOW_INCOMPLETE');
    expect((await manager().post(`${N}/steps`, { step: 'containment', notes: 'Ürünler yedek üniteye taşındı.' })).status).toBe(201);
    const asg = await owner().post(`${N}/assignment`, { ownerId: demo.users.manager.id, dueAt: new Date(Date.now() + 86400000).toISOString() });
    expect(asg.status).toBe(200);
    expect((await manager().post(`${N}/causes`, { stage: 'initial', categories: ['equipment'], notes: 'Kapı contası aşınmış olabilir.' })).status).toBe(201);
    const corr = await manager().post(`${N}/actions`, { kind: 'correction', description: 'Kapı contası değiştirildi.' });
    expect((await manager().post(`${N}/actions/${corr.body.id}`, { op: 'done', notes: 'Conta değişti, kapı tam kapanıyor.' })).status).toBe(200);
    // "Done" is a claim until someone else checks it.
    expect((await owner().post(`${N}/actions/${corr.body.id}`, { op: 'verify', result: 'accepted', notes: 'Kapıyı kapatıp denedim.' })).status).toBe(200);
    const ca = await manager().post(`${N}/actions`, { kind: 'corrective_action', description: 'Conta kontrolü aylık bakım listesine eklenecek.' });
    expect((await manager().post(`${N}/actions/${ca.body.id}`, { op: 'done', notes: 'Bakım listesine eklendi.' })).status).toBe(200);
    expect((await owner().post(`${N}/actions/${ca.body.id}`, { op: 'verify', result: 'accepted', notes: 'Bakım listesini gördüm.' })).status).toBe(200);
    expect((await manager().post(`${N}/causes`, { stage: 'verified', categories: ['equipment', 'process'], notes: 'Conta aşınmış; bakım planında conta kontrolü yoktu.' })).status).toBe(201);
    expect((await manager().post(`${N}/steps`, { step: 'effectiveness_check', notes: '3 gün boyunca ölçümler 2–4 °C aralığında.' })).status).toBe(201);
    expect((await owner().get(N)).body.status).toBe('awaiting_verification');
  });

  it('high risk is closed only by someone other than the person who fixed it', async () => {
    const self = await manager().post(`${C()}/nonconformities/${ncrId}/verify`, { result: 'effective', notes: 'Kontrol ettim.' });
    expect(self.body.error.code).toBe('VERIFIER_NOT_INDEPENDENT');
    const ok = await owner().post(`${C()}/nonconformities/${ncrId}/verify`, { result: 'effective', notes: 'Ölçüm kayıtları ve conta faturası incelendi.' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('closed');
  });
});

describe('indicators and audit file', () => {
  const period = `from=${today}T00:00:00%2B03:00&to=2099-01-01T00:00:00Z`;

  it('an open critical risk sets the status and caps the score', async () => {
    // Open a second high-risk case on another task, then look at the indicators.
    const t = (await owner().get(`${C()}/tasks?siteId=${demo.siteId}`)).body.find((x: any) => x.status === 'open' && x.title.includes('Eldiven'));
    if (t) {
      await owner().post(`${C()}/tasks/${t.id}/evidence`, { kind: 'checklist', answers: { gloves: 'pass', apron: 'pass' } });
      expect((await owner().post(`${C()}/tasks/${t.id}/complete`)).body.outcome).toBe('conforming');
    }
    await env.ownerDb.query(`INSERT INTO nonconformities (company_id, site_id, hazard_type, title, description, risk_level, risk_rationale, depth, detected_by)
      VALUES ($1,$2,'gas_leak','Test: gaz kokusu','test','critical','{"steps":[],"independentVerification":true}','capa',$3)`, [demo.companyId, demo.siteId, demo.users.owner.id]);
    const r = (await owner().get(`${C()}/indicators?${period}`)).body;
    expect(r.status).toBe('critical_risk');
    expect(r.components.openCriticalRisks).toBe(1);
    expect(r.score === null || r.score <= 49).toBe(true);
    expect(r.disclaimer).toContain('resmî denetim sonucu');
  });

  it('the audit file shows gaps and integrity, not only the good news', async () => {
    const r = (await owner().get(`${C()}/audit-export?${period}`)).body;
    expect(r.exampleContentWarning).toContain('ÖRNEK');
    expect(r.summary.nonconforming).toBe(1);
    expect(r.gaps.map((g: any) => g.type)).toContain('needs_expert_review');
    expect(r.integrity.auditChain.ok).toBe(true);
    expect(r.integrity.files.every((f: any) => f.status === 'intact')).toBe(true);
    expect(r.ruleVersions.some((v: any) => v.code === 'EX-COLD-CHAIN')).toBe(true);
  });

  it('detects a changed evidence file', async () => {
    const ev = (await env.ownerDb.query(`SELECT storage_key FROM evidence WHERE status = 'stored' AND storage_key IS NOT NULL LIMIT 1`)).rows[0];
    await writeFile(join(env.evidenceDir, ev.storage_key), fakeJpeg('edited-afterwards'));
    const r = (await owner().get(`${C()}/audit-export?${period}`)).body;
    expect(r.integrity.files.some((f: any) => f.status === 'modified')).toBe(true);
    expect(r.gaps.some((g: any) => g.type === 'evidence_integrity')).toBe(true);
  });

  it('the database refuses to rewrite history, even for the runtime role', async () => {
    const tamper = (sql: string) => env.db.system(tx => tx.query(sql));
    await expect(tamper(`UPDATE audit_events SET payload = '{}' WHERE seq = 1`)).rejects.toThrow();
    await expect(tamper(`DELETE FROM audit_events WHERE seq = 1`)).rejects.toThrow();
    await expect(tamper(`UPDATE evidence SET sha256 = repeat('0', 64) WHERE status = 'stored'`)).rejects.toThrow(/cannot change/);
    await expect(tamper(`UPDATE measurements SET value = 3`)).rejects.toThrow(/permission denied/);
    // Even the owner cannot edit an audit event (trigger), so a direct edit is blocked and a forged one would break the chain.
    await expect(env.ownerDb.query(`UPDATE audit_events SET payload = '{}' WHERE seq = 2`)).rejects.toThrow(/append-only/);
    expect((await owner().get(`${C()}/audit-chain/verify`)).body.ok).toBe(true);
  });
});

describe('history stays intact', () => {
  it('a profile change cancels open work but leaves completed records and their context alone', async () => {
    const before = (await owner().get(`${C()}/tasks/${fridgeTaskId}`)).body;
    await owner().post(`${C()}/profile/facts`, { siteId: demo.siteId, key: 'storage.cold', value: false, source: 'user_declared', verification: 'user_confirmed' });
    const cold = (await owner().get(`${C()}/obligations`)).body.find((x: any) => x.rule === 'EX-COLD-CHAIN');
    expect(cold.decision).toBe('not_applicable');
    const after = (await owner().get(`${C()}/tasks/${fridgeTaskId}`)).body;
    expect(after).toMatchObject({ status: 'done', outcome: 'nonconforming', obligationId: before.obligationId });
    // The old decision still shows the fact as it was when the work was done.
    const old = (await owner().get(`${C()}/obligations/${before.obligationId}/explanation`)).body;
    expect(old.matchedFacts['storage.cold'].value).toBe(true);
    expect(old.history.map((h: any) => h.decision)).toEqual(['applies', 'not_applicable']);
    await owner().post(`${C()}/profile/facts`, { siteId: demo.siteId, key: 'storage.cold', value: true, source: 'user_declared', verification: 'user_confirmed' });
  });

  it('a new rule version keeps old evidence in its original context and does not duplicate tasks', async () => {
    const { EXAMPLE_RULES } = await import('../../src/seed/demo');
    const base = EXAMPLE_RULES.find(r => r.code === 'EX-COLD-CHAIN')!;
    const prov = (await env.ownerDb.query(`SELECT id FROM provisions LIMIT 1`)).rows[0].id;
    const author = client(env, platform.author.token), reviewer = client(env, platform.reviewer.token), admin = client(env, platform.admin.token);
    const v2 = await author.post('/admin/rule-versions', { ...base, provisionIds: [prov], changeReason: 'Örnek: limit notu güncellendi',
      templates: base.templates.map(t => ({ ...t, limits: (t.limits ?? []).map(l => ({ ...l, note: 'v2 notu' })) })) });
    expect(v2.status).toBe(201);
    expect(v2.body.version).toBe(2);
    await author.post(`/admin/rule-versions/${v2.body.id}/submit`);
    expect((await author.post(`/admin/rule-versions/${v2.body.id}/approve`)).status).toBe(403); // author cannot approve own rule
    // Food-safety content needs the area specialist before the product owner can approve.
    const early = await reviewer.post(`/admin/rule-versions/${v2.body.id}/approve`);
    expect(early.body.error.code).toBe('AREA_REVIEW_MISSING');
    expect((await reviewer.post(`/admin/rule-versions/${v2.body.id}/area-review`, { area: 'food_safety', decision: 'approved', notes: 'Kendi alanım değil' })).status).toBe(403);
    const specialist = client(env, platform.specialist.token);
    expect((await specialist.post(`/admin/rule-versions/${v2.body.id}/area-review`, { area: 'food_safety', decision: 'approved', notes: 'Limit notu incelendi.' })).status).toBe(200);
    expect((await reviewer.post(`/admin/rule-versions/${v2.body.id}/approve`)).status).toBe(200);
    const impact = (await reviewer.get(`/admin/rule-versions/${v2.body.id}/impact`)).body;
    expect(impact.ruleCode).toBe('EX-COLD-CHAIN');
    expect((await admin.post(`/admin/rule-versions/${v2.body.id}/publish`)).status).toBe(200);

    const o = (await owner().get(`${C()}/obligations`)).body.find((x: any) => x.rule === 'EX-COLD-CHAIN');
    expect(o).toMatchObject({ version: 2, decision: 'applies' });
    const gen = await owner().post(`${C()}/tasks/generate`, { siteId: demo.siteId, fromDay: today, toDay: today });
    expect(gen.body.created).toBe(0); // today's fridge check already exists under v1
    const t = (await owner().get(`${C()}/tasks/${fridgeTaskId}`)).body;
    expect(t.rule.version).toBe(1);
    expect(t.measurements[0].limit_source).toMatchObject({ ruleVersion: 1, max: 4 });
  });
});

describe('access boundaries', () => {
  it("one company cannot reach another company's data, through the API or the database", async () => {
    const other = await seedDemoCompany(env.db, { name: 'Başka İşletme A.Ş.', isDemo: false });
    await env.db.tenant(other.companyId, async tx => {
      const { generateTasks } = await import('../../src/services/tasks');
      await generateTasks(tx, other.companyId, other.siteId, today, today);
    });
    const theirTask = (await env.ownerDb.query(`SELECT id FROM tasks WHERE company_id = $1 LIMIT 1`, [other.companyId])).rows[0].id;
    // Their company id, and their task id smuggled through our company path.
    expect((await owner().get(`/companies/${other.companyId}/tasks`)).status).toBe(404);
    expect((await owner().get(`${C()}/tasks/${theirTask}`)).status).toBe(404);
    expect((await owner().post(`${C()}/tasks/${theirTask}/complete`)).status).toBe(404);
    // Row-level security: a transaction bound to our company sees none of their rows even without a filter.
    const leaked = await env.db.tenant(demo.companyId, tx => tx.query(`SELECT count(*)::int AS n FROM tasks WHERE company_id = $1`, [other.companyId]));
    expect(leaked.rows[0].n).toBe(0);
    await expect(env.db.tenant(demo.companyId, tx => tx.query(
      `INSERT INTO profile_facts (company_id, key, value, source, verification) VALUES ($1, 'staff.count', '3', 'user_declared', 'user_confirmed')`, [other.companyId])))
      .rejects.toThrow(/row-level security/);
  });

  it('an expert sees only what the grant covers', async () => {
    expect((await expert().get(`${C()}/obligations`)).status).toBe(200);
    expect((await expert().get(`${C()}/tasks/${fridgeTaskId}`)).status).toBe(404);
    expect((await expert().post(`${C()}/profile/facts`, { siteId: demo.siteId, key: 'utility.lpg', value: true, source: 'expert', verification: 'expert_verified' })).status).toBe(201);
    expect((await expert().get(`${C()}/indicators?from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z`)).status).toBe(403);
  });

  it('platform staff have no implicit access to company data', async () => {
    expect((await client(env, platform.admin.token).get(`${C()}/obligations`)).status).toBe(404);
  });
});

describe('demo isolation', () => {
  it('demo reset removes demo companies and leaves real data untouched', async () => {
    const real = (await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks t JOIN companies c ON c.id = t.company_id WHERE NOT c.is_demo`)).rows[0].n;
    expect(real).toBeGreaterThan(0);
    expect((await owner().post('/admin/demo/reset')).status).toBe(403);
    const r = await client(env, platform.admin.token).post('/admin/demo/reset');
    expect(r.body.deletedCompanies).toBe(1);
    const left = (await env.ownerDb.query(`SELECT name, is_demo FROM companies`)).rows;
    expect(left).toEqual([{ name: 'Başka İşletme A.Ş.', is_demo: false }]);
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM tasks`)).rows[0].n).toBe(real);
  });
});
