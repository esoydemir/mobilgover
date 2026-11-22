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

/**
 * GM-30 devamı example rules: their document evidence accepts a reviewed service report (latest version) instead of a new upload.
 * Kept apart from EXAMPLE_RULES so existing demo databases receive them through ensureReportRules, once.
 */
export const EXAMPLE_REPORT_RULES: Omit<DraftInput, 'provisionIds'>[] = [
  {
    code: 'EX-REPORT-DOC', title: 'Soğutucu servis raporu kaydı (örnek iyi uygulama)', kind: 'good_practice', isExample: true, ambiguityNote: null,
    condition: { all: [{ fact: 'activity.food_preparation', op: 'eq', value: true }, { fact: 'storage.cold', op: 'eq', value: true }] },
    obligationTitle: 'Soğutucunun servis raporunu görev kaydına bağla',
    obligationSummary: 'Örnek iyi uygulama; mevzuat hükmü olarak sunulmaz. Servis uzmanının incelenmiş raporu belge kanıtı olarak kullanılabilir.',
    effectiveFrom: '2024-01-01', effectiveTo: null, changeReason: 'İlk örnek sürüm',
    templates: [{
      code: 'service_report_doc', title: 'Soğutucu servis raporu kaydı', instructions: 'Servis uzmanının raporu belge kasasında incelendiyse onu kanıt olarak seç; yoksa belgeyi yükle. Sonra kısa bir not ekle.',
      recurrence: { freq: 'monthly', day: 1, at: '12:00', perEquipmentType: 'refrigerator' },
      evidence: [{ kind: 'document', min: 1, acceptsServiceReport: true }, { kind: 'note', requiredWhen: 'always' }],
      limits: [], severity: 'minor', hazardType: 'cold_chain_temperature',
    }],
  },
  {
    code: 'EX-REPORT-MEAS', title: 'Servis sonrası sıcaklık doğrulaması (örnek iyi uygulama)', kind: 'good_practice', isExample: true, ambiguityNote: null,
    condition: { all: [{ fact: 'activity.food_preparation', op: 'eq', value: true }, { fact: 'storage.cold', op: 'eq', value: true }] },
    obligationTitle: 'Servisten sonra sıcaklığı ölç ve servis raporuyla birlikte kaydet',
    obligationSummary: 'Örnek iyi uygulama; mevzuat hükmü olarak sunulmaz. Rapor tek başına yetmez: ölçüm de gerekir.',
    effectiveFrom: '2024-01-01', effectiveTo: null, changeReason: 'İlk örnek sürüm',
    templates: [{
      code: 'service_report_meas', title: 'Servis sonrası sıcaklık doğrulaması', instructions: 'Ünitenin iç sıcaklığını ölç ve değeri gir; servis raporu incelendiyse belge kanıtı olarak seç.',
      recurrence: { freq: 'monthly', day: 1, at: '12:30', perEquipmentType: 'refrigerator' },
      evidence: [{ kind: 'measurement', quantity: 'temperature', unit: '°C' }, { kind: 'document', min: 1, acceptsServiceReport: true }],
      limits: [{ quantity: 'temperature', equipmentType: 'refrigerator', unit: '°C', min: 0, max: 4, basis: 'example', note: 'Örnek değer; ürün grubu ve HACCP planına göre belirlenmeli.' }],
      severity: 'major', hazardType: 'cold_chain_temperature',
    }],
  },
];

/** Sector example rules (installation work). Kept apart so existing demo databases receive them once, through ensureSectorRules. */
export const EXAMPLE_SECTOR_RULES: Omit<DraftInput, 'provisionIds'>[] = [
  {
    code: 'EX-ELEC-INSTALL', title: 'Montaj sonrası topraklama ölçüm kaydı (örnek iyi uygulama)', kind: 'good_practice', isExample: true, ambiguityNote: null,
    condition: { fact: 'activity.onsite_installation', op: 'eq', value: true },
    obligationTitle: 'Sahada yaptığın montajın topraklama ölçümünü kaydet',
    obligationSummary: 'Örnek iyi uygulama; mevzuat hükmü olarak sunulmaz. Müşteri yerinde montaj yapan işletmeler montaj sonrası ölçümü kayda geçirir.',
    effectiveFrom: '2024-01-01', effectiveTo: null, changeReason: 'İlk örnek sürüm',
    templates: [{
      code: 'install_earthing', title: 'Montaj sonrası topraklama ölçümü', instructions: 'Yaptığın montajın topraklama ölçümünü yap, listeyi doldur ve ölçüm cihazı ekranının fotoğrafını ekle. (Kabul limiti tanımlı değil; sonuç değerlendirmesi yetkili kişiye aittir.)',
      recurrence: { freq: 'monthly', day: 1, at: '14:00' },
      evidence: [{ kind: 'checklist', items: [{ id: 'earth_measured', label: 'Topraklama ölçümü yapıldı ve değer müşteriye bildirildi', critical: true }, { id: 'panel_closed', label: 'Pano kapağı kapatıldı', critical: false }] }, { kind: 'photo', min: 1 }],
      limits: [], severity: 'major', hazardType: 'electrical_safety',
    }],
  },
  {
    code: 'EX-ESTATE-FILES', title: 'Sözleşme ve yetki belgesi dosyası kontrolü (örnek iyi uygulama)', kind: 'good_practice', isExample: true, ambiguityNote: null,
    condition: { fact: 'activity.client_contracts', op: 'eq', value: true },
    obligationTitle: 'Müşteri sözleşme ve yetki belgesi dosyalarını kontrol et',
    obligationSummary: 'Örnek iyi uygulama; mevzuat hükmü olarak sunulmaz. Müşteri veya mülk sahibi adına dosya tutan ofisler imzalı sözleşme ve yetki belgelerinin eksiksiz ve süresi içinde olduğunu düzenli kontrol eder.',
    effectiveFrom: '2024-01-01', effectiveTo: null, changeReason: 'İlk örnek sürüm',
    templates: [{
      code: 'estate_file_check', title: 'Sözleşme ve yetki belgesi dosyası kontrolü', instructions: 'Açık portföydeki dosyaları gözden geçir: imzalı sözleşme, yetki belgesi ve süre bitişi. Eksik dosyanın fotoğrafını ekle. (Örnek görev.)',
      recurrence: { freq: 'monthly', day: 1, at: '10:00' },
      evidence: [{ kind: 'checklist', items: [{ id: 'contracts_signed', label: 'Açık portföydeki tüm dosyalarda imzalı sözleşme var', critical: true }, { id: 'authority_valid', label: 'Yetki belgelerinin süresi dolmamış', critical: true }] }, { kind: 'photo', min: 1 }],
      limits: [], severity: 'minor', hazardType: 'documentation',
    }],
  },
];

/** Publishes the sector example rules once on a database that already holds the platform people. */
export async function ensureSectorRules(db: Db) {
  return db.system(async tx => {
    const who = async (role: string, not?: string) => (await tx.query<{ user_id: string }>(
      `SELECT user_id FROM platform_roles WHERE role = $1 AND ($2::uuid IS NULL OR user_id <> $2) ORDER BY user_id LIMIT 1`, [role, not ?? null])).rows[0]?.user_id;
    const author = await who('rule_author'), reviewer = author ? await who('rule_reviewer', author) : undefined, admin = await who('platform_admin');
    if (!author || !reviewer || !admin) return 0;
    let added = 0;
    for (const r of EXAMPLE_SECTOR_RULES) {
      if ((await tx.query(`SELECT 1 FROM rules WHERE code = $1`, [r.code])).rowCount) continue;
      const d = await createDraft(tx, principal(author, { platformRoles: ['rule_author'] }), { ...r, provisionIds: [] });
      await submitForReview(tx, principal(author, { platformRoles: ['rule_author'] }), d.id);
      await approve(tx, principal(reviewer, { platformRoles: ['rule_reviewer'] }), d.id, 'Örnek veri: seed sırasında onaylandı.');
      await publish(tx, principal(admin, { platformRoles: ['platform_admin'] }), d.id, { allowExampleRules: true, reason: 'Örnek veri: seed sırasında yayımlandı.' });
      added++;
    }
    return added;
  });
}

/** Publishes the GM-30 devamı example rules once on a database that already holds the platform people (demo deployments only). */
export async function ensureReportRules(db: Db) {
  return db.system(async tx => {
    const who = async (role: string, not?: string) => (await tx.query<{ user_id: string }>(
      `SELECT user_id FROM platform_roles WHERE role = $1 AND ($2::uuid IS NULL OR user_id <> $2) ORDER BY user_id LIMIT 1`, [role, not ?? null])).rows[0]?.user_id;
    const author = await who('rule_author'), reviewer = author ? await who('rule_reviewer', author) : undefined, admin = await who('platform_admin');
    if (!author || !reviewer || !admin) return 0;
    let added = 0;
    for (const r of EXAMPLE_REPORT_RULES) {
      if ((await tx.query(`SELECT 1 FROM rules WHERE code = $1`, [r.code])).rowCount) continue;
      const d = await createDraft(tx, principal(author, { platformRoles: ['rule_author'] }), { ...r, provisionIds: [] });
      await submitForReview(tx, principal(author, { platformRoles: ['rule_author'] }), d.id);
      await approve(tx, principal(reviewer, { platformRoles: ['rule_reviewer'] }), d.id, 'Örnek veri: seed sırasında onaylandı.');
      await publish(tx, principal(admin, { platformRoles: ['platform_admin'] }), d.id, { allowExampleRules: true, reason: 'Örnek veri: seed sırasında yayımlandı.' });
      added++;
    }
    return added;
  });
}

/**
 * Scope revision of the example cold-chain checks (v2). v1 applied only where food is prepared AND cold storage is kept, which left out a market that
 * only sells chilled dairy. v2 applies to food businesses (prepare or sell food product) that keep product cold. This is a NEW rule version that goes
 * through the normal draft, area review, approval and publish flow; the published v1 is never edited, tasks already done stay bound to v1.
 * Limits stay EXAMPLE. Deployed databases receive it once through ensureFoodScopeRevision (seed/run.ts).
 */
const FOOD_SCOPE = { all: [{ fact: 'activity.food_business', op: 'eq', value: true }, { fact: 'storage.cold', op: 'eq', value: true }] };
export const EXAMPLE_RULE_REVISIONS: { code: string; reason: string; apply: (v1: Omit<DraftInput, 'provisionIds'>) => Omit<DraftInput, 'provisionIds'> }[] = ['EX-COLD-CHAIN', 'EX-REPORT-DOC', 'EX-REPORT-MEAS'].map(code => ({
  code, reason: 'Kapsam düzeltmesi: yalnız yemek hazırlayanlar değil, soğukta ürün saklayan gıda işletmeleri (ör. soğuk ürün satan market) de kapsanır.',
  apply: v1 => ({ ...v1, condition: FOOD_SCOPE, obligationSummary: code === 'EX-COLD-CHAIN' ? 'Soğukta ürün saklayan gıda işletmeleri (yemek hazırlayanlar ve soğuk ürün satanlar) ünite sıcaklıklarını düzenli ölçüp kaydeder. ÖRNEK kural.' : v1.obligationSummary, changeReason: 'Kapsam düzeltmesi (v2): gıda faaliyeti + soğukta saklama; yemek hazırlama şartı kalktı. ÖRNEK kural.' }),
}));

/** Moves the example cold-chain checks from v1 to the scope revision through the normal review and publish flow, once. */
/** Key order is not meaningful in jsonb; compare conditions by content so a restart never publishes the same scope again. */
const canon = (v: unknown): string => Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v);

export async function ensureFoodScopeRevision(db: Db) {
  return db.system(async tx => {
    const who = async (role: string, not?: string) => (await tx.query<{ user_id: string }>(
      `SELECT user_id FROM platform_roles WHERE role = $1 AND ($2::uuid IS NULL OR user_id <> $2) ORDER BY user_id LIMIT 1`, [role, not ?? null])).rows[0]?.user_id;
    const author = await who('rule_author'), reviewer = author ? await who('rule_reviewer', author) : undefined, admin = await who('platform_admin');
    const specialist = (await tx.query<{ user_id: string }>(`SELECT user_id FROM reviewer_areas WHERE area = 'food_safety' LIMIT 1`)).rows[0]?.user_id;
    if (!author || !reviewer || !admin) return [] as { code: string; from: number; to: number }[];
    const moved: { code: string; from: number; to: number }[] = [];
    for (const rev of EXAMPLE_RULE_REVISIONS) {
      const cur = (await tx.query(`SELECT rv.version, rv.condition FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE r.code = $1 AND rv.status = 'published'`, [rev.code])).rows[0];
      if (!cur || canon(cur.condition) === canon(FOOD_SCOPE)) continue;
      const v1 = [...EXAMPLE_RULES, ...EXAMPLE_REPORT_RULES].find(r => r.code === rev.code)!;
      const d = await createDraft(tx, principal(author, { platformRoles: ['rule_author'] }), { ...rev.apply(v1), changeReason: rev.apply(v1).changeReason, provisionIds: [] });
      await submitForReview(tx, principal(author, { platformRoles: ['rule_author'] }), d.id);
      for (const area of v1.requiredReviewAreas ?? []) if (specialist) await areaReview(tx, principal(specialist, { platformRoles: ['rule_reviewer'] }), d.id, area, 'approved', 'Kapsam düzeltmesi incelendi (ÖRNEK kural).');
      await approve(tx, principal(reviewer, { platformRoles: ['rule_reviewer'] }), d.id, rev.reason);
      await publish(tx, principal(admin, { platformRoles: ['platform_admin'] }), d.id, { allowExampleRules: true, reason: rev.reason });
      moved.push({ code: rev.code, from: cur.version, to: d.version });
    }
    return moved;
  });
}

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
      await approve(tx, principal(reviewer.id, { platformRoles: ['rule_reviewer'] }), d.id, 'Örnek veri: seed sırasında onaylandı.');
      await publish(tx, principal(admin.id, { platformRoles: ['platform_admin'] }), d.id, { allowExampleRules: true, reason: 'Örnek veri: seed sırasında yayımlandı.' });
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
                    VALUES ($1,$2,'expert','{profile_verify,obligations,obligation_review,nonconformities}',$3,'Gıda güvenliği danışmanlığı (demo)', now() + interval '90 days')`,
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
    for (const [key, value] of [['activity.food_preparation', true], ['activity.food_business', true], ['storage.cold', true], ['utility.lpg', true], ['site.province', 'İstanbul']] as const) {
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
