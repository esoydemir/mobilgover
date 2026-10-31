import type { Db } from '../db/pool';
import type { Principal } from '../domain/permissions';
import { appendAudit } from '../services/audit';
import { recomputeSite } from '../services/obligations';
import { createSession } from '../services/principal';
import { recordFact, syncEquipmentTypes } from '../services/profile';
import { approve, areaReview, createDraft, publish, submitForReview, type DraftInput } from '../services/rules';

/**
 * Demo content. EVERY rule, source and limit here is an EXAMPLE: it shows how
 * the engine works and makes no claim about Turkish law. Values such as
 * 0–4 °C are placeholders until a reviewed rule with a verified source exists.
 */
export const EXAMPLE_RULES: Omit<DraftInput, 'provisionIds'>[] = [
  {
    code: 'EX-COLD-CHAIN', title: 'Soğuk muhafaza sıcaklık kaydı (örnek)', kind: 'legal_requirement', isExample: true, ambiguityNote: null,
    condition: { all: [{ fact: 'activity.food_preparation', op: 'eq', value: true }, { fact: 'storage.cold', op: 'eq', value: true }] },
    obligationTitle: 'Soğuk muhafaza ünitelerinin sıcaklığını kayıt altında tut',
    obligationSummary: 'Gıda hazırlayan ve soğuk depolama kullanan işletmeler ünite sıcaklıklarını düzenli ölçüp kaydeder.',
    effectiveFrom: '2024-01-01', effectiveTo: null, changeReason: 'İlk örnek sürüm', requiredReviewAreas: ['food_safety'],
    templates: [{
      code: 'fridge_temp', title: 'Soğutucu sıcaklık kontrolü', instructions: 'Ünitenin iç sıcaklığını kalibreli termometreyle ölç, değeri gir ve termometre ekranının fotoğrafını ekle.',
      recurrence: { freq: 'daily', at: '18:00', perEquipmentType: 'refrigerator' },
      evidence: [{ kind: 'measurement', quantity: 'temperature', unit: '°C' }, { kind: 'photo', min: 1 }, { kind: 'note', requiredWhen: 'nonconforming' }],
      limits: [{ quantity: 'temperature', equipmentType: 'refrigerator', unit: '°C', min: 0, max: 4, basis: 'example', note: 'Örnek değer; ürün grubu ve HACCP planına göre belirlenmeli.' }],
      severity: 'critical', hazardType: 'cold_chain_temperature',
      emergencyInstruction: 'ÖRNEK TALİMAT: Ürünleri limit içindeki yedek üniteye taşı ve yöneticine hemen haber ver. Ürünün kullanımı veya imhası hakkındaki kararı yetkili kişi verir.',
    }],
  },
  {
    code: 'EX-LPG-CHECK', title: 'LPG bağlantı kontrolü (örnek)', kind: 'legal_requirement', isExample: true, ambiguityNote: null,
    condition: { fact: 'utility.lpg', op: 'eq', value: true },
    obligationTitle: 'LPG tesisatını düzenli kontrol et', obligationSummary: 'LPG kullanan işletmeler hortum, vana ve havalandırmayı düzenli kontrol eder.',
    effectiveFrom: '2024-01-01', effectiveTo: null, changeReason: 'İlk örnek sürüm', requiredReviewAreas: ['gas_safety'],
    templates: [{
      code: 'lpg_monthly', title: 'Aylık LPG bağlantı kontrolü', instructions: 'Kontrol listesindeki maddeleri yerinde incele.',
      recurrence: { freq: 'monthly', day: 1, at: '10:00' },
      evidence: [{ kind: 'checklist', items: [
        { id: 'hose', label: 'Hortumda çatlak/ezilme yok', critical: true },
        { id: 'valve', label: 'Vana kolay kapanıyor', critical: true },
        { id: 'vent', label: 'Havalandırma açık', critical: false },
      ] }, { kind: 'note', requiredWhen: 'nonconforming' }],
      limits: [], severity: 'major', hazardType: 'gas_leak',
    }],
  },
  {
    code: 'EX-GLOVE', title: 'Hijyen eldiveni kontrolü (iyi uygulama)', kind: 'good_practice', isExample: true, ambiguityNote: null,
    condition: { fact: 'activity.food_preparation', op: 'eq', value: true },
    obligationTitle: 'Vardiya başında hijyen ekipmanını kontrol et', obligationSummary: 'Önerilen iyi uygulama; mevzuat hükmü olarak sunulmaz.',
    effectiveFrom: '2024-01-01', effectiveTo: null, changeReason: 'İlk örnek sürüm',
    templates: [{
      code: 'glove_daily', title: 'Eldiven ve önlük kontrolü', instructions: 'Vardiyadaki personelin eldiven ve önlüğünü kontrol et.',
      recurrence: { freq: 'daily', at: '09:30' },
      evidence: [{ kind: 'checklist', items: [{ id: 'gloves', label: 'Eldivenler takılı', critical: false }, { id: 'apron', label: 'Önlükler temiz', critical: false }] }],
      limits: [], severity: 'minor', hazardType: 'personal_hygiene',
    }],
  },
  {
    code: 'EX-ISG-THRESHOLD', title: 'Çalışan sayısına bağlı İSG desteği (örnek, yoruma açık)', kind: 'legal_requirement', isExample: true,
    ambiguityNote: 'Örnek: eşiğin şube mi şirket mi bazında sayılacağı kaynakta net değil.',
    condition: { fact: 'staff.count', op: 'gte', value: 10 },
    obligationTitle: 'İSG hizmeti desteği al', obligationSummary: 'Belirli çalışan sayısının üzerindeki işletmeler için örnek yükümlülük.',
    effectiveFrom: '2024-01-01', effectiveTo: null, changeReason: 'İlk örnek sürüm', requiredReviewAreas: ['occupational_safety'],
    templates: [{
      code: 'isg_review', title: 'İSG risk değerlendirmesi gözden geçirme', instructions: 'Risk değerlendirmesini gözden geçir ve onayla.',
      recurrence: { freq: 'monthly', day: 1, at: '11:00' },
      evidence: [{ kind: 'document', min: 1 }, { kind: 'approval', role: 'owner' }], limits: [], severity: 'major', hazardType: 'ohs_review',
    }],
  },
];

export type DemoSeed = {
  companyId: string; siteId: string;
  users: Record<'author' | 'reviewer' | 'admin' | 'owner' | 'manager' | 'staff' | 'expert', { id: string; token: string }>;
  fridgeId: string; thermometerId: string;
  ruleVersionIds: Record<string, string>;
};

const principal = (userId: string, extra: Partial<Principal> = {}): Principal =>
  ({ userId, platformRoles: [], memberships: [], grants: [], ...extra });

async function user(db: Db, name: string, email: string | null = null) {
  return db.system(async tx => {
    const id = (await tx.query<{ id: string }>(`INSERT INTO users (display_name, email) VALUES ($1, $2) RETURNING id`, [name, email])).rows[0]!.id;
    return { id, token: await createSession(tx, id, 24 * 30) };
  });
}

/** Platform users, example sources and published example rules. Idempotent per database. */
export async function seedPlatform(db: Db) {
  const author = await user(db, 'Kural Yazarı (demo)');
  // The product owner approves pilot content; specialists review their own areas.
  const reviewer = await user(db, 'Ürün sahibi / kural onaylayıcı (demo)');
  const specialist = await user(db, 'Alan uzmanı (demo)');
  const admin = await user(db, 'Platform Yöneticisi (demo)');
  const marketReviewer = await user(db, 'Pazar yeri inceleyici (demo)');
  const ruleVersionIds: Record<string, string> = {};
  await db.system(async tx => {
    await tx.query(`INSERT INTO platform_roles VALUES ($1,'rule_author'), ($2,'rule_reviewer'), ($3,'platform_admin'), ($4,'rule_reviewer')`, [author.id, reviewer.id, admin.id, specialist.id]);
    await tx.query(`INSERT INTO reviewer_areas VALUES ($1,'food_safety'), ($1,'gas_safety'), ($1,'occupational_safety')`, [specialist.id]);
    await tx.query(`INSERT INTO platform_roles VALUES ($1,'marketplace_reviewer')`, [marketReviewer.id]);
    // EXAMPLE categories and credential names; real ones come from the marketplace policy.
    await tx.query(`INSERT INTO service_categories (code, name, description, required_credentials, is_example) VALUES
      ('refrigeration_service', 'Soğutma teknik servisi', 'Buzdolabı, soğuk oda ve soğutucu arıza/bakım', '{refrigeration_technician}', true),
      ('gas_installation_check', 'Gaz tesisatı kontrolü', 'LPG/doğal gaz bağlantı ve kaçak kontrolü', '{gas_installer}', true),
      ('food_safety_consulting', 'Gıda güvenliği danışmanlığı', 'HACCP planı, hijyen eğitimi ve iç denetim', '{food_engineer}', true)
      ON CONFLICT DO NOTHING`);
    const src = (await tx.query<{ id: string }>(
      `INSERT INTO legal_sources (code, title, issuer, kind, is_example) VALUES ('EX-SOURCE', 'ÖRNEK KAYNAK — gerçek mevzuat değildir', 'Örnek kurum', 'regulation', true) RETURNING id`)).rows[0]!.id;
    const sv = (await tx.query<{ id: string }>(
      `INSERT INTO source_versions (source_id, version_label, published_on, effective_from) VALUES ($1, 'örnek-1', '2024-01-01', '2024-01-01') RETURNING id`, [src])).rows[0]!.id;
    const prov = (await tx.query<{ id: string }>(
      `INSERT INTO provisions (source_version_id, ref, excerpt) VALUES ($1, 'Örnek Madde 1', 'Bu metin örnektir ve hiçbir resmî düzenlemeyi temsil etmez.') RETURNING id`, [sv])).rows[0]!.id;
    for (const r of EXAMPLE_RULES) {
      const d = await createDraft(tx, principal(author.id, { platformRoles: ['rule_author'] }), { ...r, provisionIds: r.kind === 'legal_requirement' ? [prov] : [] });
      await submitForReview(tx, principal(author.id, { platformRoles: ['rule_author'] }), d.id);
      for (const area of r.requiredReviewAreas ?? []) {
        await areaReview(tx, principal(specialist.id, { platformRoles: ['rule_reviewer'] }), d.id, area, 'approved', 'Örnek içerik olarak incelendi (demo).');
      }
      await approve(tx, principal(reviewer.id, { platformRoles: ['rule_reviewer'] }), d.id);
      await publish(tx, principal(admin.id, { platformRoles: ['platform_admin'] }), d.id, { allowExampleRules: true });
      ruleVersionIds[r.code] = d.id;
    }
  });
  return { author, reviewer, specialist, admin, marketReviewer, ruleVersionIds };
}

/** One demo café with a site, people, equipment and a partly filled profile. */
export async function seedDemoCompany(db: Db, opts: { name?: string; isDemo?: boolean } = {}) {
  const owner = await user(db, 'Ahmet (işletme sahibi)');
  const manager = await user(db, 'Selin (şube yöneticisi)');
  const staff = await user(db, 'Elif (personel)');
  const expert = await user(db, 'Dr. Zeynep (uzman)');
  const ids = await db.system(async tx => {
    const companyId = (await tx.query<{ id: string }>(`INSERT INTO companies (name, is_demo) VALUES ($1, $2) RETURNING id`,
      [opts.name ?? 'Kahve Durağı (DEMO)', opts.isDemo ?? true])).rows[0]!.id;
    const siteId = (await tx.query<{ id: string }>(`INSERT INTO sites (company_id, name) VALUES ($1, 'Kadıköy Moda') RETURNING id`, [companyId])).rows[0]!.id;
    await tx.query(`INSERT INTO memberships (user_id, company_id, site_id, role) VALUES ($1,$4,NULL,'owner'), ($2,$4,$5,'site_manager'), ($3,$4,$5,'staff')`,
      [owner.id, manager.id, staff.id, companyId, siteId]);
    await tx.query(`INSERT INTO access_grants (company_id, user_id, kind, scopes, granted_by, reason, expires_at)
                    VALUES ($1,$2,'expert','{profile_verify,obligations,nonconformities}',$3,'Gıda güvenliği danışmanlığı (demo)', now() + interval '90 days')`,
      [companyId, expert.id, owner.id]);
    const fridgeId = (await tx.query<{ id: string }>(`INSERT INTO equipment (company_id, site_id, type, name, serial) VALUES ($1,$2,'refrigerator','Buzdolabı · Mutfak arka','GH-EQ-4471') RETURNING id`, [companyId, siteId])).rows[0]!.id;
    const thermometerId = (await tx.query<{ id: string }>(`INSERT INTO equipment (company_id, site_id, type, name, calibrated_until) VALUES ($1,$2,'thermometer','Dijital termometre', (now() + interval '180 days')::date) RETURNING id`, [companyId, siteId])).rows[0]!.id;
    await appendAudit(tx, { companyId, actorId: null, eventType: 'company.created', entityType: 'company', entityId: companyId, payload: { demo: opts.isDemo ?? true } });
    await syncEquipmentTypes(tx, companyId, siteId);
    return { companyId, siteId, fridgeId, thermometerId };
  });
  // Owner declares the profile; staff count is left unanswered on purpose (shows "needs info").
  const ownerP = principal(owner.id, { memberships: [{ companyId: ids.companyId, siteId: null, role: 'owner' }] });
  await db.tenant(ids.companyId, async tx => {
    for (const [key, value] of [['activity.food_preparation', true], ['storage.cold', true], ['utility.lpg', true], ['site.province', 'İstanbul']] as const) {
      await recordFact(tx, ownerP, ids.companyId, { siteId: ids.siteId, key, value, source: 'user_declared', verification: 'user_confirmed' });
    }
    await recomputeSite(tx, ids.companyId, ids.siteId, owner.id);
  });
  return { ...ids, users: { owner, manager, staff, expert } };
}

/**
 * A demo refrigeration provider whose identity and (example) credential were
 * checked by the demo marketplace reviewer, authorized for one category.
 */
export async function seedDemoProvider(db: Db, marketReviewerId: string, email: string | null = null) {
  const provider = await user(db, 'Murat Yıldız (demo uzman)', email);
  const { upsertProfile, submitVerification, requestAuthorization, decideVerification, decideAuthorization } = await import('../services/marketplace');
  const me = principal(provider.id);
  const rev = principal(marketReviewerId, { platformRoles: ['marketplace_reviewer'] });
  await db.system(async tx => {
    await upsertProfile(tx, me, { kind: 'individual', displayName: 'Murat Yıldız', headline: 'Soğutma teknisyeni · 11 yıl', city: 'İstanbul', district: 'Kadıköy', bio: 'Ticari soğutucu arıza ve bakım (demo profil).' });
    const id = await submitVerification(tx, me, { kind: 'identity', issuer: 'T.C. kimlik (demo)', documentRef: 'DEMO-KIMLIK' });
    const cred = await submitVerification(tx, me, { kind: 'credential', credentialType: 'refrigeration_technician', issuer: 'Örnek belgelendirme kuruluşu', documentRef: 'DEMO-BELGE-001', validUntil: '2030-01-01' });
    await decideVerification(tx, rev, id.id, { decision: 'verified', checkMethod: 'Demo: belge görüntüsü incelendi', notes: '' });
    await decideVerification(tx, rev, cred.id, { decision: 'verified', checkMethod: 'Demo: belge numarası sorgulandı', notes: '' });
    const a = await requestAuthorization(tx, me, 'refrigeration_service');
    await decideAuthorization(tx, rev, a.id, { decision: 'approved', reason: 'Demo: kimlik ve soğutma teknisyeni belgesi doğrulandı.', validUntil: '2029-12-31' });
  });
  return provider;
}
