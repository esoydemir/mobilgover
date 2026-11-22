import type { Tx } from '../db/pool';
import { invalid } from '../domain/errors';
import { NACE_VERSION, dealsWithFood, dealsWithBrokerage, lookupNace, normalizeNace } from '../domain/nace';
import type { Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { recomputeSite } from './obligations';
import { currentFacts, recordFact } from './profile';
import { topUpSite } from './tasks';

/**
 * Registration step "faaliyet": the owner picks NACE classes and confirms them.
 * What is derived from them (food preparation) is recorded as the owner's confirmed statement with the
 * class code as its source reference, so a later task can be traced back to the exact answer.
 * A class we do not know is never guessed: nothing is derived, the codes are kept, the case is audited
 * for review, and dependent obligations stay "needs info" (never "not applicable").
 */
export async function confirmActivity(tx: Tx, p: Principal, companyId: string, input: { naceCodes: string[]; confirmed: boolean }) {
  if (!input.confirmed) throw invalid('Faaliyeti onaylamadan kayıt yapılamaz.');
  const codes: string[] = [];
  for (const raw of input.naceCodes) {
    const c = normalizeNace(raw);
    if (!c) throw invalid(`"${raw}" bir NACE kodu değil (ör. 56.10).`);
    if (!codes.includes(c)) codes.push(c);
  }
  if (!codes.length) throw invalid('En az bir faaliyet kodu seçin.');
  const known = codes.map(lookupNace).filter((n): n is NonNullable<ReturnType<typeof lookupNace>> => !!n);
  const unknown = codes.filter(c => !lookupNace(c));

  await recordFact(tx, p, companyId, { siteId: null, key: 'activity.nace_codes', value: codes, source: 'user_declared', verification: 'user_confirmed', sourceRef: NACE_VERSION });
  if (unknown.length) {
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'activity.nace_needs_review', entityType: 'company', entityId: companyId, payload: { unknown, catalogue: NACE_VERSION } });
  }

  const sites = (await tx.query<{ id: string }>(`SELECT id FROM sites WHERE company_id = $1 ORDER BY created_at`, [companyId])).rows.map(r => r.id);
  for (const siteId of sites) await applyActivityToSite(tx, p, companyId, siteId);
  return { codes, known: known.map(k => ({ code: k.code, title: k.title })), unknown, needsReview: unknown.length > 0 };
}

/**
 * Derives the site-level activity statement from the company's confirmed classes (also used for a branch added later)
 * and recomputes the site. Re-running with the same answers records nothing new and creates no task twice.
 */
export async function applyActivityToSite(tx: Tx, p: Principal, companyId: string, siteId: string) {
  const facts = await currentFacts(tx, companyId, siteId);
  const codes = facts['activity.nace_codes']?.value;
  if (Array.isArray(codes) && codes.length && codes.every(c => typeof c === 'string' && lookupNace(c))) {
    const entries = (codes as string[]).map(c => lookupNace(c)!);
    const food = entries.some(e => e.foodPreparation);
    const ref = `${NACE_VERSION}:${codes.join(',')}`;
    const cur = facts['activity.food_preparation'];
    if (cur?.value !== food || cur.verification === 'rejected') {
      await recordFact(tx, p, companyId, { siteId, key: 'activity.food_preparation', value: food, source: 'user_declared', verification: 'user_confirmed', sourceRef: ref,
        note: `Onaylanan faaliyet kodlarından türetildi: ${codes.join(', ')}` });
    }
    const foodBusiness = entries.some(dealsWithFood);
    const curB = facts['activity.food_business'];
    if (curB?.value !== foodBusiness || curB.verification === 'rejected') {
      await recordFact(tx, p, companyId, { siteId, key: 'activity.food_business', value: foodBusiness, source: 'user_declared', verification: 'user_confirmed', sourceRef: ref,
        note: `Onaylanan faaliyet kodlarından türetildi: ${codes.join(', ')}` });
    }
    const brokerage = entries.some(dealsWithBrokerage);
    const curK = facts['activity.brokerage'];
    if (curK?.value !== brokerage || curK.verification === 'rejected') {
      await recordFact(tx, p, companyId, { siteId, key: 'activity.brokerage', value: brokerage, source: 'user_declared', verification: 'user_confirmed', sourceRef: ref,
        note: `Onaylanan faaliyet kodlarından türetildi: ${codes.join(', ')}` });
    }
  }
  const r = await recomputeSite(tx, companyId, siteId, p.userId);
  const created = (await topUpSite(tx, companyId, siteId, 14, p.userId)).created;
  return { ...r, createdTasks: created };
}
