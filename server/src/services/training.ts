import type { Tx } from '../db/pool';
import { AppError, conflict, forbidden, invalid, notFound } from '../domain/errors';
import { can, type Action, type Principal } from '../domain/permissions';
import { appendAudit } from './audit';
import { notify } from './notifications';

/**
 * Training → application → field effectiveness.
 *
 * Content: a course has versions (draft → in_review → published → archived). Writing and publishing
 * are separate rights; the author of a version may not publish it while someone else can.
 * Example (platform) courses are labelled and read-only.
 *
 * Assignment: a manager assigns the published version to a person, optionally for a nonconformity.
 * Separate facts, each with its time: read, completed, passed the short assessment, and
 * "effective in the field" — confirmed by someone other than the learner after seeing the work done.
 * None of these closes a nonconformity. A participation record is not an official certificate.
 */
export type QuizQ = { q: string; options: string[]; answer: number };
export type CourseInput = { title: string; summary: string; body: string; videoUrl: string | null; quiz: QuizQ[]; passScore: number; minutes: number | null;
  links: { kind: 'task_template' | 'rule' | 'hazard'; ref: string }[] };

export const PARTICIPATION_NOTE = 'GoverHub katılım kaydıdır; resmî sertifika ya da yetkili kurum belgesi değildir.';
export const EXAMPLE_NOTE = 'ÖRNEK İÇERİK — mevzuat metni ya da onaylı uzman görüşü değildir.';
/** Business content stays inside the business: never published to the network or a platform library. */
export const inhouseNote = (independent: boolean | null) => independent === false ? 'İşletme içi içerik · bağımsız inceleme yapılmadı' : 'İşletme içi içerik';

/** The person holds this right somewhere in the business (any site they cover). */
function holds(p: Principal, action: Action, companyId: string, siteId?: string | null) {
  if (siteId !== undefined) return can(p, action, { companyId, siteId }).ok;
  return p.memberships.some(m => m.companyId === companyId && can(p, action, { companyId, siteId: m.siteId }).ok);
}

function checkContent(b: Pick<CourseInput, 'title' | 'body' | 'quiz' | 'passScore'>, strict: boolean) {
  if (b.title.trim().length < 3) throw invalid('Eğitime bir ad ver.');
  if (strict && b.body.trim().length < 20) throw invalid('İçerik metni çok kısa (en az birkaç cümle).');
  if (b.quiz.length > 10) throw invalid('En fazla 10 soru.');
  b.quiz.forEach((q, i) => {
    if (q.q.trim().length < 3) throw invalid(`${i + 1}. soru boş.`);
    const opts = q.options.map(o => o.trim()).filter(Boolean);
    if (opts.length < 2 || opts.length > 5) throw invalid(`${i + 1}. soruda 2–5 seçenek olmalı.`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= opts.length) throw invalid(`${i + 1}. sorunun doğru cevabını seç.`);
  });
  if (b.passScore < 1 || b.passScore > 100) throw invalid('Geçme puanı 1–100 olmalı.');
}
const cleanQuiz = (quiz: QuizQ[]) => quiz.map(q => ({ q: q.q.trim(), options: q.options.map(o => o.trim()).filter(Boolean), answer: q.answer }));

async function setLinks(tx: Tx, companyId: string, courseId: string, links: CourseInput['links']) {
  await tx.query(`DELETE FROM training_links WHERE course_id = $1`, [courseId]);
  for (const l of links.slice(0, 20)) {
    if (!l.ref.trim()) continue;
    await tx.query(`INSERT INTO training_links (course_id, company_id, kind, ref) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [courseId, companyId, l.kind, l.ref.trim()]);
  }
}

const COURSE_SQL = `SELECT c.id, c.company_id, c.is_example, c.created_at,
   (SELECT row_to_json(v) FROM (SELECT id, version, status, title, summary, minutes, published_at, independent_review, jsonb_array_length(quiz) AS questions FROM training_versions
      WHERE course_id = c.id AND status = 'published') v) AS published,
   (SELECT row_to_json(v) FROM (SELECT id, version, status, title FROM training_versions WHERE course_id = c.id ORDER BY version DESC LIMIT 1) v) AS latest,
   COALESCE((SELECT json_agg(json_build_object('kind', l.kind, 'ref', l.ref)) FROM training_links l WHERE l.course_id = c.id), '[]') AS links
 FROM training_courses c`;

export async function listCourses(tx: Tx, p: Principal, companyId: string) {
  const author = holds(p, 'training.author', companyId) || holds(p, 'training.publish', companyId);
  const rows = (await tx.query(`${COURSE_SQL} WHERE c.company_id = $1 OR c.company_id IS NULL ORDER BY c.is_example, c.created_at DESC`, [companyId])).rows;
  // Learners and verifiers see published content only; authors also see their drafts and reviews.
  return rows.filter(r => r.published || (author && r.company_id)).map(r => ({ ...r, exampleNote: r.is_example ? EXAMPLE_NOTE : null,
    inhouseNote: r.is_example ? null : inhouseNote(r.published?.independent_review ?? null) }));
}

export async function relatedCourses(tx: Tx, companyId: string, refs: { hazard?: string | null; templateCode?: string | null; ruleCode?: string | null }) {
  const pairs = [['hazard', refs.hazard], ['task_template', refs.templateCode], ['rule', refs.ruleCode]].filter(([, v]) => !!v) as [string, string][];
  if (!pairs.length) return [];
  return (await tx.query(`SELECT DISTINCT c.id, c.is_example, v.title, v.summary, v.minutes FROM training_links l JOIN training_courses c ON c.id = l.course_id
     JOIN training_versions v ON v.course_id = c.id AND v.status = 'published'
    WHERE (c.company_id = $1 OR c.company_id IS NULL) AND (l.kind, l.ref) IN (SELECT * FROM unnest($2::text[], $3::text[]))`,
    [companyId, pairs.map(x => x[0]), pairs.map(x => x[1])])).rows;
}

async function loadCourse(tx: Tx, companyId: string, courseId: string) {
  const c = (await tx.query(`SELECT * FROM training_courses WHERE id = $1 AND (company_id = $2 OR company_id IS NULL)`, [courseId, companyId])).rows[0];
  if (!c) throw notFound('Eğitim');
  return c;
}

export async function getCourse(tx: Tx, p: Principal, companyId: string, courseId: string) {
  const c = await loadCourse(tx, companyId, courseId);
  const author = !c.is_example && holds(p, 'training.author', companyId);
  const publisher = !c.is_example && holds(p, 'training.publish', companyId);
  const versions = (await tx.query(`SELECT v.*, cu.display_name AS created_by_name, su.display_name AS submitted_by_name, pu.display_name AS published_by_name
     FROM training_versions v LEFT JOIN users cu ON cu.id = v.created_by LEFT JOIN users su ON su.id = v.submitted_by LEFT JOIN users pu ON pu.id = v.published_by
    WHERE v.course_id = $1 ORDER BY v.version DESC`, [courseId])).rows
    .filter(v => author || publisher || v.status === 'published')
    // The answer key is for authors and publishers only.
    .map(v => author || publisher ? v : { ...v, quiz: (v.quiz as QuizQ[]).map(q => ({ q: q.q, options: q.options })) });
  if (!versions.length) throw notFound('Eğitim');
  const links = (await tx.query(`SELECT kind, ref FROM training_links WHERE course_id = $1 ORDER BY kind, ref`, [courseId])).rows;
  const open = versions.find(v => v.status === 'draft' || v.status === 'in_review');
  // The author of a version in review publishes it only if nobody else in the business can (same rule as changeStatus).
  let publishBlockedReason: string | null = null;
  if (publisher && open?.status === 'in_review' && (open.submitted_by ?? open.created_by) === p.userId) {
    const others = (await tx.query(`SELECT 1 FROM memberships WHERE company_id = $1 AND status = 'active' AND site_id IS NULL AND role IN ('owner','hq_manager') AND user_id <> $2`,
      [companyId, p.userId])).rowCount;
    if (others) publishBlockedReason = 'Bu sürümü sen incelemeye gönderdin; işletmede yayımlama yetkisi olan başka biri var, o yayımlamalı. Bildirim gönderildi.';
  }
  return {
    id: c.id, isExample: c.is_example, exampleNote: c.is_example ? EXAMPLE_NOTE : null, versions, links,
    inhouseNote: c.is_example ? null : inhouseNote(versions.find(v => v.status === 'published')?.independent_review ?? null),
    permissions: { author, publish: publisher, publishBlockedReason, assign: holds(p, 'training.assign', companyId) && versions.some(v => v.status === 'published'),
      newVersion: author && !open },
  };
}

export async function createCourse(tx: Tx, p: Principal, companyId: string, b: CourseInput) {
  if (!holds(p, 'training.author', companyId)) throw forbidden('Eğitim içeriği yazma yetkin yok.');
  checkContent(b, false);
  const c = (await tx.query<{ id: string }>(`INSERT INTO training_courses (company_id, created_by) VALUES ($1,$2) RETURNING id`, [companyId, p.userId])).rows[0]!;
  const v = (await tx.query<{ id: string }>(`INSERT INTO training_versions (course_id, company_id, version, title, summary, body, video_url, quiz, pass_score, minutes, created_by)
     VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [c.id, companyId, b.title.trim(), b.summary.trim(), b.body, b.videoUrl?.trim() || null, JSON.stringify(cleanQuiz(b.quiz)), b.passScore, b.minutes, p.userId])).rows[0]!;
  await setLinks(tx, companyId, c.id, b.links);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'training.created', entityType: 'training_course', entityId: c.id, payload: { versionId: v.id, title: b.title.trim() } });
  return { id: c.id, versionId: v.id };
}

async function loadVersion(tx: Tx, companyId: string, versionId: string) {
  const v = (await tx.query(`SELECT v.*, c.is_example FROM training_versions v JOIN training_courses c ON c.id = v.course_id WHERE v.id = $1 FOR UPDATE OF v`, [versionId])).rows[0];
  if (!v || v.company_id !== companyId) throw notFound('Eğitim sürümü');
  return v;
}

export async function updateDraft(tx: Tx, p: Principal, companyId: string, versionId: string, b: CourseInput) {
  if (!holds(p, 'training.author', companyId)) throw forbidden('Eğitim içeriği yazma yetkin yok.');
  const v = await loadVersion(tx, companyId, versionId);
  if (v.status !== 'draft') throw conflict('NOT_DRAFT', 'Yalnızca taslak düzenlenir; yayımlanmış içerik için yeni sürüm aç.');
  checkContent(b, false);
  await tx.query(`UPDATE training_versions SET title = $2, summary = $3, body = $4, video_url = $5, quiz = $6, pass_score = $7, minutes = $8 WHERE id = $1`,
    [versionId, b.title.trim(), b.summary.trim(), b.body, b.videoUrl?.trim() || null, JSON.stringify(cleanQuiz(b.quiz)), b.passScore, b.minutes]);
  await setLinks(tx, companyId, v.course_id, b.links);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'training.draft_saved', entityType: 'training_course', entityId: v.course_id, payload: { versionId } });
}

export async function changeStatus(tx: Tx, p: Principal, companyId: string, versionId: string, op: 'submit' | 'reject' | 'publish', notes: string | null) {
  const v = await loadVersion(tx, companyId, versionId);
  if (op === 'submit') {
    if (!holds(p, 'training.author', companyId)) throw forbidden('Eğitim içeriği yazma yetkin yok.');
    if (v.status !== 'draft') throw conflict('NOT_DRAFT', 'Yalnızca taslak incelemeye gönderilir.');
    checkContent({ title: v.title, body: v.body, quiz: v.quiz, passScore: v.pass_score }, true);
    await tx.query(`UPDATE training_versions SET status = 'in_review', submitted_by = $2, submitted_at = clock_timestamp() WHERE id = $1`, [versionId, p.userId]);
    const publishers = (await tx.query<{ user_id: string }>(`SELECT DISTINCT user_id FROM memberships WHERE company_id = $1 AND status = 'active' AND site_id IS NULL AND role IN ('owner','hq_manager')`, [companyId])).rows.map(r => r.user_id);
    await notify(tx, { companyId, siteId: null, userIds: publishers, except: p.userId, kind: 'training_review_requested', entityType: 'training_course', entityId: v.course_id,
      dedupeKey: `training_review:${versionId}`, title: 'Eğitim içeriği yayın onayı bekliyor', body: `${v.title} · sürüm ${v.version}` });
  } else {
    if (!holds(p, 'training.publish', companyId)) throw forbidden('Eğitim yayımlama yetkin yok; içerik yazma ve yayımlama ayrı yetkilerdir.');
    if (v.status !== 'in_review') throw conflict('NOT_IN_REVIEW', 'Yalnızca incelemedeki içerik yayımlanır ya da geri gönderilir.');
    if (op === 'reject') {
      if ((notes ?? '').trim().length < 5) throw invalid('Neden geri gönderdiğini yaz.');
      await tx.query(`UPDATE training_versions SET status = 'draft', review_notes = $2 WHERE id = $1`, [versionId, notes!.trim()]);
    } else {
      // Four eyes where possible: the author publishes only if nobody else in the business can.
      const author = v.submitted_by ?? v.created_by;
      if (author === p.userId) {
        const others = (await tx.query(`SELECT 1 FROM memberships WHERE company_id = $1 AND status = 'active' AND site_id IS NULL AND role IN ('owner','hq_manager') AND user_id <> $2`,
          [companyId, p.userId])).rowCount;
        if (others) throw new AppError(422, 'PUBLISHER_IS_AUTHOR', 'İçeriği yazan ya da incelemeye gönderen kişi yayımlayamaz; başka bir yetkili yayımlamalı.');
      }
      await tx.query(`UPDATE training_versions SET status = 'archived', archived_at = clock_timestamp() WHERE course_id = $1 AND status = 'published'`, [v.course_id]);
      // Recorded and shown: was it approved by someone other than its author?
      await tx.query(`UPDATE training_versions SET status = 'published', published_by = $2, published_at = clock_timestamp(), review_notes = $3, independent_review = $4 WHERE id = $1`,
        [versionId, p.userId, notes?.trim() || null, author !== p.userId]);
    }
  }
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: `training.${op}`, entityType: 'training_course', entityId: v.course_id, payload: { versionId, version: v.version, notes } });
}

export async function archiveCourse(tx: Tx, p: Principal, companyId: string, courseId: string) {
  if (!holds(p, 'training.publish', companyId)) throw forbidden('Arşivleme yayımlama yetkisi ister.');
  const c = await loadCourse(tx, companyId, courseId);
  if (c.is_example) throw forbidden('Örnek içerik arşivlenemez.');
  const r = await tx.query(`UPDATE training_versions SET status = 'archived', archived_at = clock_timestamp() WHERE course_id = $1 AND status = 'published'`, [courseId]);
  if (!r.rowCount) throw conflict('NOT_PUBLISHED', 'Yayımlanmış sürüm yok.');
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'training.archived', entityType: 'training_course', entityId: courseId, payload: {} });
}

export async function newVersion(tx: Tx, p: Principal, companyId: string, courseId: string) {
  if (!holds(p, 'training.author', companyId)) throw forbidden('Eğitim içeriği yazma yetkin yok.');
  const c = await loadCourse(tx, companyId, courseId);
  if (c.is_example) throw forbidden('Örnek içerik değiştirilemez.');
  await tx.query(`SELECT 1 FROM training_courses WHERE id = $1 FOR UPDATE`, [courseId]);
  if ((await tx.query(`SELECT 1 FROM training_versions WHERE course_id = $1 AND status IN ('draft','in_review')`, [courseId])).rowCount) throw conflict('DRAFT_EXISTS', 'Bu eğitimin açık bir taslağı var.');
  const last = (await tx.query(`SELECT * FROM training_versions WHERE course_id = $1 ORDER BY version DESC LIMIT 1`, [courseId])).rows[0];
  const v = (await tx.query<{ id: string }>(`INSERT INTO training_versions (course_id, company_id, version, title, summary, body, video_url, quiz, pass_score, minutes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [courseId, companyId, last.version + 1, last.title, last.summary, last.body, last.video_url, JSON.stringify(last.quiz), last.pass_score, last.minutes, p.userId])).rows[0]!;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'training.new_version', entityType: 'training_course', entityId: courseId, payload: { versionId: v.id, version: last.version + 1 } });
  return { versionId: v.id };
}

// ── Assignments ──

export async function assign(tx: Tx, p: Principal, companyId: string, b: { courseId: string; userId: string; siteId: string; dueAt: string | null; reason: string; ncrId: string | null; actionId: string | null }) {
  if (!can(p, 'training.assign', { companyId, siteId: b.siteId }).ok) throw forbidden('Bu şubede eğitim atama yetkin yok.');
  if (b.reason.trim().length < 5) throw invalid('Neden atadığını yaz (ör. uygunsuzlukta bilgi eksikliği).');
  await loadCourse(tx, companyId, b.courseId);
  const v = (await tx.query(`SELECT id, title FROM training_versions WHERE course_id = $1 AND status = 'published'`, [b.courseId])).rows[0];
  if (!v) throw conflict('NOT_PUBLISHED', 'Yalnızca yayımlanmış eğitim atanır.');
  const member = (await tx.query(`SELECT 1 FROM memberships WHERE user_id = $1 AND company_id = $2 AND status = 'active' AND (site_id IS NULL OR site_id = $3)`,
    [b.userId, companyId, b.siteId])).rowCount;
  if (!member) throw invalid('Bu kişi bu şubede etkin üye değil.');
  if (b.ncrId) {
    const n = (await tx.query(`SELECT site_id FROM nonconformities WHERE id = $1 AND company_id = $2`, [b.ncrId, companyId])).rows[0];
    if (!n || n.site_id !== b.siteId) throw invalid('Uygunsuzluk bu şubede değil.');
  }
  if (b.actionId && !(await tx.query(`SELECT 1 FROM ncr_actions WHERE id = $1 AND ncr_id = $2`, [b.actionId, b.ncrId])).rowCount) throw invalid('Aksiyon bu uygunsuzluğa ait değil.');
  if ((await tx.query(`SELECT 1 FROM training_assignments WHERE course_id = $1 AND user_id = $2 AND ncr_id IS NOT DISTINCT FROM $3 AND cancelled_at IS NULL AND field_verified_at IS NULL`,
    [b.courseId, b.userId, b.ncrId])).rowCount) throw conflict('ALREADY_ASSIGNED', 'Bu kişiye bu eğitim zaten atanmış ve henüz sahada doğrulanmamış.');
  const a = (await tx.query<{ id: string }>(`INSERT INTO training_assignments (company_id, site_id, course_id, version_id, user_id, assigned_by, due_at, reason, ncr_id, action_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [companyId, b.siteId, b.courseId, v.id, b.userId, p.userId, b.dueAt, b.reason.trim(), b.ncrId, b.actionId])).rows[0]!;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'training.assigned', entityType: 'training_assignment', entityId: a.id,
    payload: { courseId: b.courseId, versionId: v.id, userId: b.userId, ncrId: b.ncrId, actionId: b.actionId, dueAt: b.dueAt, reason: b.reason.trim() } });
  if (b.ncrId) {
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.training_assigned', entityType: 'nonconformity', entityId: b.ncrId,
      payload: { assignmentId: a.id, title: v.title, userId: b.userId } });
  }
  await notify(tx, { companyId, siteId: b.siteId, userIds: [b.userId], except: p.userId, kind: 'training_assigned', entityType: 'training_assignment', entityId: a.id,
    dedupeKey: `training_assigned:${a.id}`, title: 'Sana bir eğitim atandı', body: `${v.title} · ${b.reason.trim()}` });
  return { id: a.id };
}

const ASSIGN_SQL = `SELECT a.*, v.title, v.summary, v.minutes, v.version, jsonb_array_length(v.quiz) AS questions, v.pass_score, c.is_example, v.independent_review,
   u.display_name AS user_name, ab.display_name AS assigned_by_name, fu.display_name AS field_verified_by_name, n.title AS ncr_title
 FROM training_assignments a JOIN training_versions v ON v.id = a.version_id JOIN training_courses c ON c.id = a.course_id
 JOIN users u ON u.id = a.user_id JOIN users ab ON ab.id = a.assigned_by LEFT JOIN users fu ON fu.id = a.field_verified_by
 LEFT JOIN nonconformities n ON n.id = a.ncr_id`;

/** Separate facts, never merged into one "done". */
export function stateOf(a: any) {
  return {
    read: !!a.read_at, completed: !!a.completed_at, passed: Number(a.questions) === 0 ? null : !!a.passed_at,
    fieldVerified: a.field_verified_at ? a.field_result : null, cancelled: !!a.cancelled_at,
    overdue: !a.cancelled_at && !a.completed_at && !!a.due_at && new Date(a.due_at) < new Date(),
  };
}

export async function listAssignments(tx: Tx, p: Principal, companyId: string, scope: 'mine' | 'managed', ncrId?: string | null) {
  const rows = (await tx.query(`${ASSIGN_SQL} WHERE a.company_id = $1 AND ($2::uuid IS NULL OR a.ncr_id = $2) ORDER BY a.assigned_at DESC LIMIT 300`, [companyId, ncrId ?? null])).rows;
  return rows.filter(a => scope === 'mine' ? a.user_id === p.userId : can(p, 'training.assign', { companyId, siteId: a.site_id }).ok)
    .map(a => ({ id: a.id, title: a.title, version: a.version, isExample: a.is_example, userId: a.user_id, userName: a.user_name, assignedByName: a.assigned_by_name,
      assignedAt: a.assigned_at, dueAt: a.due_at, reason: a.reason, ncrId: a.ncr_id, ncrTitle: a.ncr_title, questions: Number(a.questions), bestScore: a.best_score,
      state: stateOf(a), fieldVerifiedByName: a.field_verified_by_name, fieldNotes: a.field_notes }));
}

async function loadAssignment(tx: Tx, p: Principal, companyId: string, id: string, forUpdate = false) {
  const a = (await tx.query(`${ASSIGN_SQL} WHERE a.id = $1 AND a.company_id = $2 ${forUpdate ? 'FOR UPDATE OF a' : ''}`, [id, companyId])).rows[0];
  const manager = !!a && can(p, 'training.assign', { companyId, siteId: a.site_id }).ok;
  if (!a || (a.user_id !== p.userId && !manager)) throw notFound('Eğitim ataması');
  return { a, manager, learner: a.user_id === p.userId };
}

export async function getAssignment(tx: Tx, p: Principal, companyId: string, id: string) {
  const { a, manager, learner } = await loadAssignment(tx, p, companyId, id);
  const v = (await tx.query(`SELECT body, video_url, quiz, summary FROM training_versions WHERE id = $1`, [a.version_id])).rows[0];
  const attempts = (await tx.query(`SELECT score, passed, created_at FROM training_attempts WHERE assignment_id = $1 ORDER BY created_at`, [id])).rows;
  const st = stateOf(a);
  const actions = a.ncr_id ? (await tx.query(`SELECT id, description, status, verification_status, performed_by, done_by FROM ncr_actions WHERE ncr_id = $1 ORDER BY created_at`, [a.ncr_id])).rows : [];
  return {
    id: a.id, title: a.title, version: a.version, summary: v.summary, body: v.body, videoUrl: v.video_url, minutes: a.minutes,
    isExample: a.is_example, exampleNote: a.is_example ? EXAMPLE_NOTE : null, participationNote: PARTICIPATION_NOTE,
    inhouseNote: a.is_example ? null : inhouseNote(a.independent_review), previousAssignmentId: a.previous_assignment_id,
    laterAssignmentId: (await tx.query(`SELECT id FROM training_assignments WHERE previous_assignment_id = $1`, [id])).rows[0]?.id ?? null,
    quiz: (v.quiz as QuizQ[]).map(q => ({ q: q.q, options: q.options })), passScore: a.pass_score,
    userId: a.user_id, userName: a.user_name, assignedByName: a.assigned_by_name, assignedAt: a.assigned_at, dueAt: a.due_at, reason: a.reason,
    ncrId: a.ncr_id, ncrTitle: a.ncr_title, actionId: a.action_id,
    readAt: a.read_at, completedAt: a.completed_at, passedAt: a.passed_at, bestScore: a.best_score, attempts,
    fieldVerifiedAt: a.field_verified_at, fieldVerifiedByName: a.field_verified_by_name, fieldNotes: a.field_notes, fieldResult: a.field_result, fieldActionId: a.field_action_id,
    cancelledAt: a.cancelled_at, cancelReason: a.cancel_reason, state: st,
    // Field evidence the verifier may point to: actions of the linked case done by the learner.
    fieldActions: actions.filter(x => x.status === 'done' && (x.performed_by === a.user_id || x.done_by === a.user_id)),
    permissions: {
      read: learner && !a.cancelled_at && !a.read_at,
      complete: learner && !a.cancelled_at && !!a.read_at && !a.completed_at,
      attempt: learner && !a.cancelled_at && !!a.read_at && Number(a.questions) > 0 && !a.passed_at,
      fieldVerify: manager && !learner && !a.cancelled_at && !a.field_verified_at && !!a.completed_at && (Number(a.questions) === 0 || !!a.passed_at)
        && can(p, 'training.verify', { companyId, siteId: a.site_id }).ok,
      fieldVerifyBlockedReason: manager && learner ? 'Kendi eğitiminin sahadaki etkinliğini doğrulayamazsın.' : null,
      cancel: manager && !a.cancelled_at && !a.field_verified_at,
      changeDue: manager && !a.cancelled_at && !a.completed_at,
      // After "not effective in the field": retrain (new assignment, this one kept) or add an action on the case.
      retrain: manager && a.field_result === 'not_effective' && !(await tx.query(`SELECT 1 FROM training_assignments WHERE previous_assignment_id = $1`, [id])).rowCount,
    },
  };
}

export async function learnerStep(tx: Tx, p: Principal, companyId: string, id: string, step: 'read' | 'complete') {
  const { a, learner } = await loadAssignment(tx, p, companyId, id, true);
  if (!learner) throw forbidden('Bu adımı eğitimi alan kişi kaydeder.');
  if (a.cancelled_at) throw conflict('CANCELLED', 'Bu atama iptal edildi.');
  if (step === 'read') {
    if (a.read_at) return { changed: false };
    await tx.query(`UPDATE training_assignments SET read_at = clock_timestamp() WHERE id = $1`, [id]);
  } else {
    if (!a.read_at) throw conflict('NOT_READ', 'Önce içeriği okuduğunu/izlediğini işaretle.');
    if (a.completed_at) return { changed: false };
    await tx.query(`UPDATE training_assignments SET completed_at = clock_timestamp() WHERE id = $1`, [id]);
    await notify(tx, { companyId, siteId: a.site_id, userIds: [a.assigned_by], except: p.userId, kind: 'training_completed', entityType: 'training_assignment', entityId: id,
      dedupeKey: `training_completed:${id}`, title: 'Eğitim tamamlandı: sahada etkinliğini doğrula', body: `${a.user_name} · ${a.title}. Tamamlanması uygunsuzluğu kapatmaz.` });
  }
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: `training.${step}`, entityType: 'training_assignment', entityId: id, payload: {} });
  return { changed: true };
}

export async function attempt(tx: Tx, p: Principal, companyId: string, id: string, answers: number[]) {
  const { a, learner } = await loadAssignment(tx, p, companyId, id, true);
  if (!learner) throw forbidden('Değerlendirmeyi eğitimi alan kişi çözer.');
  if (a.cancelled_at) throw conflict('CANCELLED', 'Bu atama iptal edildi.');
  if (!a.read_at) throw conflict('NOT_READ', 'Önce içeriği oku.');
  if (a.passed_at) throw conflict('ALREADY_PASSED', 'Değerlendirmeyi zaten geçtin.');
  const quiz = (await tx.query(`SELECT quiz FROM training_versions WHERE id = $1`, [a.version_id])).rows[0].quiz as QuizQ[];
  if (!quiz.length) throw conflict('NO_QUIZ', 'Bu eğitimde değerlendirme yok.');
  if (answers.length !== quiz.length) throw invalid('Bütün soruları cevapla.');
  const correct = quiz.filter((q, i) => answers[i] === q.answer).length;
  const score = Math.round((correct / quiz.length) * 100);
  const passed = score >= a.pass_score;
  await tx.query(`INSERT INTO training_attempts (company_id, assignment_id, answers, score, passed) VALUES ($1,$2,$3,$4,$5)`, [companyId, id, JSON.stringify(answers), score, passed]);
  await tx.query(`UPDATE training_assignments SET attempts = attempts + 1, best_score = GREATEST(COALESCE(best_score, 0), $2), passed_at = CASE WHEN $3 THEN clock_timestamp() ELSE passed_at END WHERE id = $1`,
    [id, score, passed]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'training.attempt', entityType: 'training_assignment', entityId: id, payload: { score, passed } });
  // Which questions were wrong, without revealing the right answers.
  return { score, passed, passScore: a.pass_score, wrong: quiz.map((q, i) => (answers[i] === q.answer ? null : i)).filter((x): x is number => x !== null) };
}

/**
 * "Effective in the field": someone other than the learner, after the training was completed (and
 * the assessment passed), records what they saw — optionally pointing to the action the learner did
 * on the linked case. This never closes the case; the case has its own verification.
 */
export async function fieldVerify(tx: Tx, p: Principal, companyId: string, id: string, b: { result: 'effective' | 'not_effective'; notes: string; actionId: string | null }) {
  const { a, learner } = await loadAssignment(tx, p, companyId, id, true);
  if (learner) throw new AppError(422, 'VERIFIER_IS_LEARNER', 'Kendi eğitiminin sahadaki etkinliğini doğrulayamazsın.');
  if (!can(p, 'training.verify', { companyId, siteId: a.site_id }).ok) throw forbidden('Sahada etkinlik doğrulama yetkin yok.');
  if (a.cancelled_at) throw conflict('CANCELLED', 'Bu atama iptal edildi.');
  if (a.field_verified_at) throw conflict('ALREADY_VERIFIED', 'Sahadaki etkinlik zaten kaydedildi.');
  if (!a.completed_at) throw conflict('NOT_COMPLETED', 'Eğitim tamamlanmadan sahadaki etkinlik doğrulanmaz.');
  if (Number(a.questions) > 0 && !a.passed_at) throw conflict('NOT_PASSED', 'Değerlendirme geçilmeden sahadaki etkinlik doğrulanmaz.');
  if (b.notes.trim().length < 10) throw invalid('Sahada neyi gördüğünü yaz (en az bir cümle).');
  if (b.actionId) {
    const act = (await tx.query(`SELECT * FROM ncr_actions WHERE id = $1 AND ncr_id = $2`, [b.actionId, a.ncr_id])).rows[0];
    if (!act || act.status !== 'done' || (act.performed_by !== a.user_id && act.done_by !== a.user_id)) throw invalid('Seçilen aksiyon bu kişinin bu kayıtta yaptığı bir iş değil.');
  }
  await tx.query(`UPDATE training_assignments SET field_verified_at = clock_timestamp(), field_verified_by = $2, field_notes = $3, field_result = $4, field_action_id = $5 WHERE id = $1`,
    [id, p.userId, b.notes.trim(), b.result, b.actionId]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'training.field_verified', entityType: 'training_assignment', entityId: id,
    payload: { result: b.result, notes: b.notes.trim(), actionId: b.actionId } });
  if (a.ncr_id) {
    await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.training_field_verified', entityType: 'nonconformity', entityId: a.ncr_id,
      payload: { assignmentId: id, title: a.title, result: b.result, userName: a.user_name } });
  }
  await notify(tx, { companyId, siteId: a.site_id, userIds: [a.user_id], except: p.userId, kind: 'training_field_verified', entityType: 'training_assignment', entityId: id,
    dedupeKey: `training_field_verified:${id}`, title: b.result === 'effective' ? 'Eğitimin sahada etkili bulundu' : 'Eğitim sahada henüz yeterli bulunmadı', body: `${a.title} · ${b.notes.trim()}` });
  return { result: b.result };
}

export async function cancelAssignment(tx: Tx, p: Principal, companyId: string, id: string, reason: string) {
  const { a, manager } = await loadAssignment(tx, p, companyId, id, true);
  if (!manager) throw forbidden();
  if (a.cancelled_at || a.field_verified_at) throw conflict('NOT_OPEN', 'Bu atama artık değiştirilemez.');
  if (reason.trim().length < 5) throw invalid('İptal gerekçesi yaz.');
  await tx.query(`UPDATE training_assignments SET cancelled_at = clock_timestamp(), cancel_reason = $2 WHERE id = $1`, [id, reason.trim()]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'training.cancelled', entityType: 'training_assignment', entityId: id, payload: { reason: reason.trim() } });
}

/** Change the due date (managers); the learner is told; announced again by the deadline scan. */
export async function changeDue(tx: Tx, p: Principal, companyId: string, id: string, b: { dueAt: string | null; reason: string }) {
  const { a, manager } = await loadAssignment(tx, p, companyId, id, true);
  if (!manager) throw forbidden();
  if (a.cancelled_at || a.completed_at) throw conflict('NOT_OPEN', 'Tamamlanmış ya da iptal edilmiş atamanın termini değişmez.');
  if (b.reason.trim().length < 5) throw invalid('Termin değişikliğinin gerekçesini yaz.');
  await tx.query(`UPDATE training_assignments SET due_at = $2 WHERE id = $1`, [id, b.dueAt]);
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'training.due_changed', entityType: 'training_assignment', entityId: id,
    payload: { from: a.due_at, to: b.dueAt, reason: b.reason.trim() } });
  await notify(tx, { companyId, siteId: a.site_id, userIds: [a.user_id], except: p.userId, kind: 'training_due_changed', entityType: 'training_assignment', entityId: id,
    dedupeKey: `training_due_changed:${id}:${b.dueAt ?? 'none'}`, title: 'Eğitim termini değişti', body: `${a.title} · ${b.reason.trim()}` });
}

/**
 * Retraining after the field check found the training not effective. The earlier assignment, with
 * its read / completed / passed / field result, stays exactly as recorded; a new one points back to it.
 */
export async function retrain(tx: Tx, p: Principal, companyId: string, id: string, b: { dueAt: string | null; reason: string }) {
  const { a, manager } = await loadAssignment(tx, p, companyId, id, true);
  if (!manager) throw forbidden();
  if (a.field_result !== 'not_effective') throw conflict('NOT_INEFFECTIVE', 'Yeniden eğitim, sahada "etkili değil" bulunan atamadan başlatılır.');
  if ((await tx.query(`SELECT 1 FROM training_assignments WHERE previous_assignment_id = $1`, [id])).rowCount) throw conflict('ALREADY_RETRAINED', 'Bu atama için yeniden eğitim zaten başlatıldı.');
  if (b.reason.trim().length < 5) throw invalid('Yeniden eğitimin nedenini yaz.');
  const v = (await tx.query(`SELECT id, title FROM training_versions WHERE course_id = $1 AND status = 'published'`, [a.course_id])).rows[0];
  if (!v) throw conflict('NOT_PUBLISHED', 'Bu eğitimin yayımlanmış sürümü yok.');
  const n = (await tx.query<{ id: string }>(`INSERT INTO training_assignments (company_id, site_id, course_id, version_id, user_id, assigned_by, due_at, reason, ncr_id, action_id, previous_assignment_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [companyId, a.site_id, a.course_id, v.id, a.user_id, p.userId, b.dueAt, b.reason.trim(), a.ncr_id, a.action_id, id])).rows[0]!;
  await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'training.retrained', entityType: 'training_assignment', entityId: n.id, payload: { previous: id, reason: b.reason.trim() } });
  if (a.ncr_id) await appendAudit(tx, { companyId, actorId: p.userId, eventType: 'nonconformity.training_assigned', entityType: 'nonconformity', entityId: a.ncr_id,
    payload: { assignmentId: n.id, title: v.title, userId: a.user_id, retraining: true } });
  await notify(tx, { companyId, siteId: a.site_id, userIds: [a.user_id], except: p.userId, kind: 'training_assigned', entityType: 'training_assignment', entityId: n.id,
    dedupeKey: `training_assigned:${n.id}`, title: 'Yeniden eğitim atandı', body: `${v.title} · ${b.reason.trim()}` });
  return { id: n.id };
}

/**
 * Who, for one course: assigned (by whom), read, completed, passed, field-verified — each separate,
 * per version. A completion stays tied to the version it was made on, even after a new version.
 * Managers only; a site manager sees the people of their own site.
 */
export async function coursePeople(tx: Tx, p: Principal, companyId: string, courseId: string) {
  if (!holds(p, 'training.assign', companyId)) throw forbidden();
  const rows = (await tx.query(`SELECT a.id, a.site_id, a.user_id, u.display_name AS user_name, ab.display_name AS assigned_by_name, a.assigned_at, a.due_at, a.reason,
       v.version, v.status AS version_status, a.read_at, a.completed_at, a.passed_at, a.best_score, a.field_result, a.field_verified_at, fv.display_name AS field_verified_by_name,
       a.cancelled_at, a.previous_assignment_id
     FROM training_assignments a JOIN users u ON u.id = a.user_id JOIN users ab ON ab.id = a.assigned_by JOIN training_versions v ON v.id = a.version_id
     LEFT JOIN users fv ON fv.id = a.field_verified_by WHERE a.company_id = $1 AND a.course_id = $2 ORDER BY v.version DESC, a.assigned_at DESC`, [companyId, courseId])).rows
    .filter(r => can(p, 'training.assign', { companyId, siteId: r.site_id }).ok);
  const count = (f: (r: any) => boolean) => rows.filter(r => !r.cancelled_at && f(r)).length;
  return {
    summary: { assigned: count(() => true), read: count(r => !!r.read_at), completed: count(r => !!r.completed_at), passed: count(r => !!r.passed_at),
      fieldEffective: count(r => r.field_result === 'effective'), fieldNotEffective: count(r => r.field_result === 'not_effective'), retrainings: count(r => !!r.previous_assignment_id) },
    people: rows.map(({ site_id, ...r }) => r),
    note: 'Her satır bir atamadır; tamamlama, yapıldığı sürüme bağlı kalır. Katılım kaydı resmî sertifika değildir.',
  };
}
