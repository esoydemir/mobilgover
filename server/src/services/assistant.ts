import type { Tx } from '../db/pool';
import { forbidden, invalid } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { canReadDoc } from './documents';
import { currentObligations } from './obligations';

/*
 * GoverHub assistant, source-bound.
 *  - No canned answers and no model-made claims: every line of an answer is a quote or a plain statement about a record of THIS business,
 *    with a numbered source the person can open. Nothing the sources do not say is added.
 *  - If nothing in the business's documents, tasks or published rules matches the question, the answer says there is not enough source.
 *  - Example rules and example sources are labelled as such; they are never presented as verified legislation.
 *  - Penalty amounts are out of scope for the pilot: a question about them is declined, not estimated.
 *  - A language model can be added behind `answerFrom` later; the sources and the "not enough source" rule stay the same.
 */

type Source = { n: number; kind: 'obligation' | 'provision' | 'document' | 'task'; title: string; text: string; route: string | null; isExample: boolean; verifiedLaw: boolean; score: number };

const STOP = new Set(['ve', 'ile', 'bir', 'bu', 'şu', 'o', 'mi', 'mı', 'mu', 'mü', 'için', 'ne', 'nasıl', 'neden', 'kadar', 'daha', 'çok', 'de', 'da', 'ki', 'olan', 'var', 'yok', 'mı?', 'nedir', 'gerekir', 'gerekiyor', 'lazım', 'ben', 'benim', 'bizim', 'biz', 'hangi', 'ise', 'veya', 'ya']);
const fold = (s: string) => s.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}\s]/gu, ' ');
const stem = (w: string) => (w.length > 6 ? w.slice(0, 6) : w);
// Words that appear in almost every rule or document text say nothing about the topic; they never count as a match.
const GENERIC = new Set(['kullan', 'işletm', 'yapıl', 'edilm', 'gereki', 'olmal', 'olacak', 'düzenl', 'kontro', 'gerçek', 'zaman', 'şekild', 'bilgi']);
const terms = (s: string) => [...new Set(fold(s).split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)).map(stem).filter(w => !GENERIC.has(w)))];

const FINE = /\bceza\b|para\s+cezas|idari\s+yapt[ıi]r[ıi]m\s+tutar|kaç\s+(tl|lira)|ne\s+kadar\s+(öder|ceza)|₺/i;

const score = (q: string[], text: string) => {
  const t = terms(text);
  let n = 0;
  for (const w of q) if (t.includes(w)) n++;
  return n;
};

export async function ask(tx: Tx, p: Principal, companyId: string, b: { question: string; siteId?: string | null }) {
  const question = b.question.trim();
  if (question.length < 5) throw invalid('Sorunu biraz daha ayrıntılı yaz.');
  if (question.length > 600) throw invalid('Soru 600 karakteri aşıyor.');
  if (!p.memberships.some(m => m.companyId === companyId)) throw forbidden();

  if (FINE.test(question)) {
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'assistant.asked', entityType: 'company', entityId: companyId, payload: { outcome: 'fine_declined', length: question.length } });
    return { question, sufficient: false, outcome: 'fine_declined' as const,
      answer: 'Ceza tutarı hesaplamıyorum: pilotta doğrulanmış bir ceza tablosu yok ve tutar tahmin edilmez. Bunun yerine bu konuda sende açık olan risk kalemlerini ve ilgili yükümlülüğün kaynağını gösterebilirim; "yükümlülük" ya da "risk" kelimesiyle sor.',
      sources: [] as Omit<Source, 'score'>[], notes: ['Ceza tutarı kapsam dışı (pilot kararı).'] };
  }

  const q = terms(question);
  const sources: Source[] = [];
  const manager = p.memberships.some(m => m.companyId === companyId && m.role !== 'staff');

  if (manager) {
    const sites = (await tx.query<{ id: string }>(`SELECT id FROM sites WHERE company_id = $1 AND ($2::uuid IS NULL OR id = $2)`, [companyId, b.siteId ?? null])).rows
      .filter(s => can(p, 'obligation.read', { companyId, siteId: s.id }).ok);
    const seen = new Set<string>();
    for (const s of sites) {
      for (const o of (await currentObligations(tx, companyId, s.id)).filter(x => x.decision === 'applies')) {
        if (seen.has(o.rule_id)) continue;
        seen.add(o.rule_id);
        const rv = (await tx.query(`SELECT obligation_summary, provision_ids, kind FROM rule_versions WHERE id = $1`, [o.rule_version_id])).rows[0];
        const sc = score(q, `${o.obligation_title} ${rv.obligation_summary}`);
        if (sc > 0) sources.push({ n: 0, kind: 'obligation', title: o.obligation_title, text: rv.obligation_summary, route: '/obligations', isExample: o.is_example, verifiedLaw: false, score: sc + 1 });
        const prov = (await tx.query(`SELECT pr.ref, pr.excerpt, ls.title AS source_title, ls.is_example FROM provisions pr JOIN source_versions sv ON sv.id = pr.source_version_id
           JOIN legal_sources ls ON ls.id = sv.source_id WHERE pr.id = ANY($1)`, [rv.provision_ids])).rows;
        for (const pv of prov) {
          const ps = score(q, `${pv.ref} ${pv.excerpt}`);
          if (ps > 0) sources.push({ n: 0, kind: 'provision', title: `${pv.source_title} · ${pv.ref}`, text: pv.excerpt, route: '/obligations', isExample: pv.is_example || o.is_example, verifiedLaw: !pv.is_example && !o.is_example, score: ps + 1 });
        }
      }
    }
  }

  const docs = (await tx.query(`SELECT d.id, d.site_id, d.title, d.doc_type, d.issuer, d.document_no, v.valid_until, v.review_status FROM documents d
     LEFT JOIN LATERAL (SELECT valid_until, review_status FROM document_versions WHERE document_id = d.id ORDER BY version DESC LIMIT 1) v ON true
    WHERE d.company_id = $1 AND d.archived_at IS NULL`, [companyId])).rows;
  for (const d of docs) {
    if (!(await canReadDoc(tx, p, companyId, d))) continue;
    const text = `${d.title} ${d.doc_type} ${d.issuer ?? ''} ${d.document_no ?? ''}`;
    const sc = score(q, text);
    if (sc > 0) sources.push({ n: 0, kind: 'document', title: d.title,
      text: `${d.issuer ? `Düzenleyen: ${d.issuer}. ` : ''}${d.document_no ? `No: ${d.document_no}. ` : ''}${d.valid_until ? `Son geçerlilik (kayıtlı): ${String(d.valid_until).slice(0, 10)}.` : 'Geçerlilik tarihi kayıtlı değil.'} ${d.review_status === 'verified' ? 'İncelendi.' : 'Henüz incelenmedi; geçerli belge sayılmaz.'}`,
      route: `/documents/${d.id}`, isExample: false, verifiedLaw: false, score: sc + 1 });
  }

  const tasks = (await tx.query(`SELECT t.id, tt.title, tt.instructions, t.due_at FROM tasks t JOIN task_templates tt ON tt.id = t.template_id
     WHERE t.company_id = $1 AND t.status = 'open' AND ($2::boolean OR t.assignee_id = $3) AND t.due_at < now() + interval '30 days' ORDER BY t.due_at LIMIT 200`, [companyId, manager, p.userId])).rows;
  for (const t of tasks) {
    const sc = score(q, `${t.title} ${t.instructions ?? ''}`);
    if (sc > 0) sources.push({ n: 0, kind: 'task', title: t.title, text: `Açık görev, son tarih ${new Date(t.due_at).toISOString().slice(0, 10)}. ${t.instructions ?? ''}`.trim(), route: `/task/${t.id}`, isExample: false, verifiedLaw: false, score: sc + 1 });
  }

  const top = sources.sort((a, b2) => b2.score - a.score).slice(0, 4).map((s, i) => ({ ...s, n: i + 1 }));
  // A source counts only if it shares at least two topic words with the question (one is enough for a very short question).
  const need = q.length <= 3 ? 1 : 2;
  const enough = top.length > 0 && top[0]!.score - 1 >= need;
  const notes: string[] = [];
  let answer: string;
  if (!enough) {
    answer = 'Bu soruyu işletmenin belgelerinde, açık görevlerinde ya da yayımlanmış yükümlülüklerinde yeterince karşılayan bir kaynak bulamadım, bu yüzden bir şey söylemiyorum. Soruyu belge adı, ekipman ya da yükümlülük adıyla yeniden sorabilir ya da ilgili belgeyi belge kasasına ekleyebilirsin.';
    notes.push('Yetersiz kaynak: yanıt üretilmedi.');
  } else {
    answer = `Sorunla eşleşen ${top.length} kaynak buldum. Aşağıdaki satırlar kaynakların kendi ifadesidir; ekleme yapılmadı.\n` + top.map(s => `[${s.n}] ${s.title}: ${s.text}`).join('\n');
    if (top.some(s => s.isExample)) notes.push('Bazı kaynaklar ÖRNEK kural/kaynaktır; doğrulanmış mevzuat değildir.');
    if (!top.some(s => s.verifiedLaw)) notes.push('Doğrulanmış bir mevzuat maddesi bu yanıtın dayanağı değil; hukuki görüş yerine geçmez.');
    if (top.some(s => s.kind === 'document' && /Henüz incelenmedi/.test(s.text))) notes.push('İncelenmemiş belge geçerli sayılmaz.');
  }
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'assistant.asked', entityType: 'company', entityId: companyId,
    payload: { outcome: enough ? 'answered' : 'insufficient', sourceKinds: top.map(s => s.kind), length: question.length } });
  return { question, sufficient: enough, outcome: enough ? ('answered' as const) : ('insufficient' as const), answer,
    sources: enough ? top.map(({ score: _s, ...s }) => s) : [], notes };
}
