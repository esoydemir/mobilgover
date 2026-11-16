import type { Db, Tx } from '../db/pool';
import { forbidden, invalid } from '../domain/errors';
import { can, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { canReadDoc } from './documents';
import { currentObligations } from './obligations';
import { askModel, type LlmConfig, type PromptSource } from './llm';

/*
 * GoverHub assistant, source-bound.
 *  - No canned answers and no model-made claims: every line of an answer is a quote or a plain statement about a record of THIS business,
 *    with a numbered source the person can open. Nothing the sources do not say is added.
 *  - If nothing in the business's documents, tasks or published rules matches the question, the answer says there is not enough source.
 *  - Example rules and example sources are labelled as such; they are never presented as verified legislation.
 *  - Penalty amounts are out of scope for the pilot: a question about them is declined, not estimated.
 *  - A language model (llm.ts, optional) only phrases an answer from the sources already filtered for this person; its output is checked
 *    (real citations, no amounts, no numbers outside the sources) and, if it is unreachable or misbehaves, the sources are still shown.
 */

type Source = { n: number; kind: 'obligation' | 'provision' | 'document' | 'task'; title: string; locator: string; text: string; route: string | null; isExample: boolean; verifiedLaw: boolean; score: number };

/** A document's own text (a reading of its file) is cut into short sections, each of which can be cited. */
export function sections(text: string, max = 600): string[] {
  const out: string[] = []; let cur = '';
  for (const line of text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
    if (cur && cur.length + line.length + 1 > max) { out.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + line;
  }
  if (cur) out.push(cur);
  return out;
}

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

type Prepared =
  | { done: Result }
  | { done: null; question: string; top: Source[]; enough: boolean };

async function prepare(tx: Tx, p: Principal, companyId: string, b: { question: string; siteId?: string | null }): Promise<Prepared> {
  const question = b.question.trim();
  if (question.length < 5) throw invalid('Sorunu biraz daha ayrıntılı yaz.');
  if (question.length > 600) throw invalid('Soru 600 karakteri aşıyor.');
  if (!p.memberships.some(m => m.companyId === companyId)) throw forbidden();

  if (FINE.test(question)) {
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'assistant.asked', entityType: 'company', entityId: companyId, payload: { outcome: 'fine_declined', length: question.length } });
    return { done: { question, sufficient: false, outcome: 'fine_declined' as const, mode: 'sources_only' as const, model: { status: 'skipped' as const, name: null },
      answer: 'Ceza tutarı hesaplamıyorum: pilotta doğrulanmış bir ceza tablosu yok ve tutar tahmin edilmez. Bunun yerine bu konuda sende açık olan risk kalemlerini ve ilgili yükümlülüğün kaynağını gösterebilirim; "yükümlülük" ya da "risk" kelimesiyle sor.',
      sources: [] as PublicSource[], notes: ['Ceza tutarı kapsam dışı (pilot kararı).'] } };
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
        if (sc > 0) sources.push({ n: 0, kind: 'obligation', title: o.obligation_title, locator: `Kural ${o.rule_code} · sürüm ${o.rule_version}`, text: rv.obligation_summary, route: '/obligations', isExample: o.is_example, verifiedLaw: false, score: sc + 1 });
        const prov = (await tx.query(`SELECT pr.ref, pr.excerpt, ls.title AS source_title, ls.is_example FROM provisions pr JOIN source_versions sv ON sv.id = pr.source_version_id
           JOIN legal_sources ls ON ls.id = sv.source_id WHERE pr.id = ANY($1)`, [rv.provision_ids])).rows;
        for (const pv of prov) {
          const ps = score(q, `${pv.ref} ${pv.excerpt}`);
          if (ps > 0) sources.push({ n: 0, kind: 'provision', title: `${pv.source_title} · ${pv.ref}`, locator: `Kural ${o.rule_code} · sürüm ${o.rule_version} · ${pv.ref}`, text: pv.excerpt, route: '/obligations', isExample: pv.is_example || o.is_example, verifiedLaw: !pv.is_example && !o.is_example, score: ps + 1 });
        }
      }
    }
  }

  const docs = (await tx.query(`SELECT d.id, d.site_id, d.title, d.doc_type, d.issuer, d.document_no, v.id AS version_id, v.version, v.valid_until, v.review_status FROM documents d
     LEFT JOIN LATERAL (SELECT id, version, valid_until, review_status FROM document_versions WHERE document_id = d.id ORDER BY version DESC LIMIT 1) v ON true
    WHERE d.company_id = $1 AND d.archived_at IS NULL`, [companyId])).rows;
  for (const d of docs) {
    if (!(await canReadDoc(tx, p, companyId, d))) continue;
    const text = `${d.title} ${d.doc_type} ${d.issuer ?? ''} ${d.document_no ?? ''}`;
    const sc = score(q, text);
    if (sc > 0) sources.push({ n: 0, kind: 'document', title: d.title, locator: `Belge · sürüm ${d.version ?? '—'} · kayıt bilgileri`,
      text: `${d.issuer ? `Düzenleyen: ${d.issuer}. ` : ''}${d.document_no ? `No: ${d.document_no}. ` : ''}${d.valid_until ? `Son geçerlilik (kayıtlı): ${String(d.valid_until).slice(0, 10)}.` : 'Geçerlilik tarihi kayıtlı değil.'} ${d.review_status === 'verified' ? 'İncelendi.' : 'Henüz incelenmedi; geçerli belge sayılmaz.'}`,
      route: `/documents/${d.id}`, isExample: false, verifiedLaw: false, score: sc + 1 });
    // The reading of the document's own file (text layer or OCR), cut into sections; it is an automatic reading, not a verified record.
    if (d.version_id) {
      const ex = (await tx.query(`SELECT source_text, method FROM document_extractions WHERE version_id = $1 AND source_text IS NOT NULL AND status <> 'dismissed' ORDER BY created_at DESC LIMIT 1`, [d.version_id])).rows[0];
      if (ex) sections(ex.source_text).forEach((sec, i) => {
        const ss = score(q, `${d.title} ${sec}`);
        if (ss > 0) sources.push({ n: 0, kind: 'document', title: d.title, locator: `Belge · sürüm ${d.version} · bölüm ${i + 1} (${ex.method === 'pdf_text' ? 'dosyadan okunan metin' : ex.method ? 'dosyadan OCR ile okunan metin, doğrulanmamış' : 'elle girilen/yapıştırılan metin'})`, text: sec, route: `/documents/${d.id}`, isExample: false, verifiedLaw: false, score: ss + 1 });
      });
    }
  }

  const tasks = (await tx.query(`SELECT t.id, tt.title, tt.instructions, t.due_at FROM tasks t JOIN task_templates tt ON tt.id = t.template_id
     WHERE t.company_id = $1 AND t.status = 'open' AND ($2::boolean OR t.assignee_id = $3) AND t.due_at < now() + interval '30 days' ORDER BY t.due_at LIMIT 200`, [companyId, manager, p.userId])).rows;
  for (const t of tasks) {
    const sc = score(q, `${t.title} ${t.instructions ?? ''}`);
    if (sc > 0) sources.push({ n: 0, kind: 'task', title: t.title, locator: 'Açık görev', text: `Açık görev, son tarih ${new Date(t.due_at).toISOString().slice(0, 10)}. ${t.instructions ?? ''}`.trim(), route: `/task/${t.id}`, isExample: false, verifiedLaw: false, score: sc + 1 });
  }

  const top = sources.sort((a, b2) => b2.score - a.score).slice(0, 6).map((s, i) => ({ ...s, n: i + 1 }));
  // A source counts only if it shares at least two topic words with the question (one is enough for a very short question).
  const need = q.length <= 3 ? 1 : 2;
  const enough = top.length > 0 && top[0]!.score - 1 >= need;
  if (!enough) {
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'assistant.asked', entityType: 'company', entityId: companyId, payload: { outcome: 'insufficient', sourceKinds: [], length: question.length, mode: 'sources_only' } });
    return { done: { question, sufficient: false, outcome: 'insufficient', mode: 'sources_only', model: { status: 'skipped', name: null },
      answer: 'Bu soruyu işletmenin belgelerinde, açık görevlerinde ya da yayımlanmış yükümlülüklerinde yeterince karşılayan bir kaynak bulamadım, bu yüzden bir şey söylemiyorum. Soruyu belge adı, ekipman ya da yükümlülük adıyla yeniden sorabilir ya da ilgili belgeyi belge kasasına ekleyebilirsin.',
      sources: [], notes: ['Yetersiz kaynak: yanıt üretilmedi.'] } };
  }
  return { done: null, question, top, enough };
}

export type PublicSource = Omit<Source, 'score'> & { cited?: boolean };
export type Result = { question: string; sufficient: boolean; outcome: 'answered' | 'insufficient' | 'conflict' | 'fine_declined'; mode: 'model' | 'sources_only';
  model: { status: 'used' | 'not_configured' | 'unreachable' | 'invalid_output' | 'rejected' | 'skipped'; name: string | null; detail?: string }; answer: string; sources: PublicSource[]; notes: string[] };

const MODEL_NOTE: Record<string, string> = {
  unreachable: 'Dil modeline ulaşılamadı; ilgili kaynaklar olduğu gibi listelendi.',
  invalid_output: 'Dil modelinin yanıtı kullanılamadı; ilgili kaynaklar olduğu gibi listelendi.',
  rejected: 'Dil modelinin yanıtı kurallara uymadığı için kullanılmadı; ilgili kaynaklar olduğu gibi listelendi.',
};

const publicSource = ({ score: _s, ...s }: Source): PublicSource => s;

/**
 * Answers a question for a person. The sources are gathered and filtered inside the business's own scope first; the model (when configured)
 * runs outside any transaction and only sees those sources. A refusal, a missing source or a failing model never produces an invented answer.
 */
export async function ask(db: Db, llm: LlmConfig | null, p: Principal, companyId: string, b: { question: string; siteId?: string | null }, fetchImpl?: typeof fetch): Promise<Result> {
  const prep = await db.tenant(companyId, tx => prepare(tx, p, companyId, b));
  if (prep.done) return prep.done;
  const { question, top } = prep;
  const notesFor = (used: Source[]) => {
    const n: string[] = [];
    if (used.some(s => s.isExample)) n.push('Bazı kaynaklar ÖRNEK kural/kaynaktır; doğrulanmış mevzuat değildir.');
    if (!used.some(s => s.verifiedLaw)) n.push('Doğrulanmış bir mevzuat maddesi bu yanıtın dayanağı değil; hukuki görüş yerine geçmez.');
    if (used.some(s => s.kind === 'document' && /Henüz incelenmedi/.test(s.text))) n.push('İncelenmemiş belge geçerli sayılmaz.');
    if (used.some(s => /OCR ile okunan/.test(s.locator))) n.push('OCR ile okunan metin hatalı olabilir; asıl dosyayla karşılaştır.');
    return n;
  };
  const extractive = (note: string): Pick<Result, 'answer' | 'sources' | 'notes'> => ({
    answer: `Sorunla eşleşen ${top.length} kaynak buldum. Aşağıdaki satırlar kaynakların kendi ifadesidir; ekleme yapılmadı.\n` + top.map(s => `[${s.n}] ${s.title}: ${s.text}`).join('\n'),
    sources: top.map(publicSource), notes: [...(note ? [note] : []), ...notesFor(top)],
  });

  let result: Result;
  if (!llm) {
    result = { question, sufficient: true, outcome: 'answered', mode: 'sources_only', model: { status: 'not_configured', name: null }, ...extractive('') };
  } else {
    const prompt: PromptSource[] = top.map(s => ({ n: s.n, title: s.title, locator: s.locator, text: s.text, isExample: s.isExample }));
    const m = await askModel(llm, question, prompt, fetchImpl);
    if (!m.ok) {
      result = { question, sufficient: true, outcome: 'answered', mode: 'sources_only', model: { status: m.reason, name: llm.model, detail: m.detail }, ...extractive(MODEL_NOTE[m.reason] ?? '') };
    } else if (m.verdict.status === 'insufficient') {
      result = { question, sufficient: false, outcome: 'insufficient', mode: 'model', model: { status: 'used', name: m.model },
        answer: `${m.verdict.answer}\nBu soruyu eldeki kaynaklar yeterince karşılamıyor; bu yüzden kesin bir şey söylemiyorum.`, sources: [], notes: ['Yetersiz kaynak: model de kaynakları yetersiz buldu.'] };
    } else {
      const cited = new Set(m.verdict.citations);
      const used = top.filter(s => cited.has(s.n));
      const conflict = m.verdict.status === 'conflict';
      result = { question, sufficient: true, outcome: conflict ? 'conflict' : 'answered', mode: 'model', model: { status: 'used', name: m.model }, answer: m.verdict.answer,
        sources: top.map(s => ({ ...publicSource(s), cited: cited.has(s.n) })).sort((a, b2) => Number(b2.cited) - Number(a.cited)),
        notes: [...(conflict ? ['Kaynaklar birbiriyle çelişiyor; hangisinin geçerli olduğunu asistan seçmedi. Kaynakları aç, gerekirse uzmanına danış.'] : []), 'Yanıtı bir dil modeli yazdı; her cümlenin dayandığı kaynağı aç ve kontrol et.', ...notesFor(used.length ? used : top)] };
    }
  }
  await db.tenant(companyId, tx => appendAudit(tx, { companyId, actorId: p.userId, eventType: 'assistant.asked', entityType: 'company', entityId: companyId,
    payload: { outcome: result.outcome, sourceKinds: top.map(s => s.kind), length: question.length, mode: result.mode, modelStatus: result.model.status, model: result.model.name } }));
  return result;
}
