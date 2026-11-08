/**
 * Permission matrix. Every server operation calls `can()`; the UI may hide
 * buttons, but it is never the thing that enforces access.
 */
export type CompanyRole = 'owner' | 'hq_manager' | 'site_manager' | 'staff';
export type GrantKind = 'expert' | 'service_provider' | 'platform_support';
export type PlatformRole = 'rule_author' | 'rule_reviewer' | 'platform_admin' | 'marketplace_reviewer' | 'network_moderator';

export type Action =
  | 'profile.read' | 'profile.write' | 'profile.verify'
  | 'obligation.read' | 'obligation.override'
  | 'equipment.read' | 'equipment.write'
  | 'task.read' | 'task.execute' | 'task.generate' | 'task.assign'
  | 'ncr.read' | 'ncr.act' | 'ncr.verify_close' | 'ncr.report' | 'ncr.manage' | 'ncr.verify' | 'obligation.review'
  | 'indicators.read' | 'audit.export' | 'audit.verify'
  | 'members.manage' | 'service.request'
  | 'document.read' | 'document.write' | 'document.review'
  // Training: writing content and publishing it are separate rights.
  | 'training.author' | 'training.publish' | 'training.assign' | 'training.verify';

/** What each company role may do. `site` = only within the member's site when the membership is site-scoped. */
export const ROLE_MATRIX: Record<CompanyRole, Action[]> = {
  owner: ['profile.read', 'profile.write', 'obligation.read', 'obligation.override', 'obligation.review', 'ncr.report', 'ncr.manage', 'equipment.read', 'equipment.write',
    'task.read', 'task.execute', 'task.generate', 'task.assign', 'ncr.read', 'ncr.act', 'ncr.verify_close', 'ncr.verify', 'indicators.read', 'audit.export', 'audit.verify',
    'members.manage', 'service.request', 'document.read', 'document.write', 'document.review',
    'training.author', 'training.publish', 'training.assign', 'training.verify'],
  hq_manager: ['profile.read', 'profile.write', 'obligation.read', 'obligation.override', 'obligation.review', 'ncr.report', 'ncr.manage', 'equipment.read', 'equipment.write',
    'task.read', 'task.execute', 'task.generate', 'task.assign', 'ncr.read', 'ncr.act', 'ncr.verify_close', 'ncr.verify', 'indicators.read', 'audit.export', 'audit.verify',
    'members.manage', 'service.request', 'document.read', 'document.write', 'document.review',
    'training.author', 'training.publish', 'training.assign', 'training.verify'],
  site_manager: ['profile.read', 'obligation.read', 'ncr.report', 'ncr.manage', 'equipment.read', 'equipment.write',
    'task.read', 'task.execute', 'task.generate', 'task.assign', 'ncr.read', 'ncr.act', 'ncr.verify_close', 'ncr.verify', 'indicators.read', 'audit.export', 'service.request',
    'document.read', 'document.write', 'document.review',
    // A site manager drafts and submits content and assigns it; publishing stays with owner / HQ.
    'training.author', 'training.assign', 'training.verify'],
  // Staff see and do their own assigned work, including emergency instructions; no scores, penalties or other people's data.
  // Staff may report a problem they see (ncr.report); they then work on what is assigned to them.
  staff: ['task.read', 'task.execute', 'ncr.read', 'ncr.act', 'ncr.report', 'equipment.read'],
};

/** For these roles and actions the target must be assigned to the user. */
const ASSIGNED_ONLY: Partial<Record<CompanyRole, Action[]>> = {
  staff: ['task.read', 'task.execute', 'ncr.read', 'ncr.act'],
};

/** Grant scopes map to actions; a grant only covers what it lists. */
export const GRANT_SCOPES: Record<string, Action[]> = {
  profile: ['profile.read'],
  profile_verify: ['profile.read', 'profile.verify'],
  obligations: ['obligation.read'],
  // An outside expert asked to review "does not apply" requests on mandatory obligations.
  obligation_review: ['obligation.read', 'obligation.review'],
  tasks: ['task.read'],
  nonconformities: ['ncr.read'],
  audit: ['audit.export', 'audit.verify'],
  // An outside expert may read the document vault; reviewing a document stays with the business.
  documents: ['document.read'],
  // An outside verifier invited by the business: may read cases and verify claimed results and
  // closures, nothing else (no actions, no assignment, no other data). Can be limited to one site.
  ncr_verify: ['ncr.read', 'ncr.verify', 'ncr.verify_close'],
  // Optional for an outside verifier: review uploaded documents (internal review; not an issuer check by the app).
  documents_review: ['document.read', 'document.review'],
};

export type Principal = {
  userId: string;
  sessionId?: string;
  email?: string | null;
  displayName?: string;
  /** This session passed a second factor. */
  mfaSatisfied?: boolean;
  mfaEnabled?: boolean;
  platformRoles: PlatformRole[];
  memberships: { companyId: string; siteId: string | null; role: CompanyRole }[];
  grants: { companyId: string; kind: GrantKind; scopes: string[]; siteId?: string | null; ncrIds?: string[] | null }[];
};

/** recordId: the nonconformity being accessed, for grants limited to selected cases. */
export type Target = { companyId: string; siteId?: string | null; assigneeId?: string | null; recordId?: string | null };

export type Permit = { ok: true; via: 'membership' | 'grant'; siteScope: string | null } | { ok: false };

export function can(p: Principal, action: Action, t: Target): Permit {
  for (const m of p.memberships) {
    if (m.companyId !== t.companyId) continue;
    // A site-scoped member never gets company-wide access, only their own site.
    if (m.siteId && m.siteId !== t.siteId) continue;
    if (!ROLE_MATRIX[m.role].includes(action)) continue;
    if (ASSIGNED_ONLY[m.role]?.includes(action) && t.assigneeId !== p.userId) continue;
    return { ok: true, via: 'membership', siteScope: m.siteId };
  }
  for (const g of p.grants) {
    if (g.companyId !== t.companyId) continue;
    // A site-limited grant covers that site only (never company-wide records).
    if (g.siteId && g.siteId !== t.siteId) continue;
    // A grant limited to selected cases covers those cases only; anything else is denied by default.
    if (g.ncrIds && !(t.recordId && g.ncrIds.includes(t.recordId))) continue;
    if (g.scopes.some(s => GRANT_SCOPES[s]?.includes(action))) return { ok: true, via: 'grant', siteScope: null };
  }
  return { ok: false };
}

/** True when the principal only sees assigned tasks in this company (staff). */
export function onlyAssignedTasks(p: Principal, companyId: string): boolean {
  const roles = p.memberships.filter(m => m.companyId === companyId).map(m => m.role);
  return roles.length > 0 && roles.every(r => r === 'staff') && !p.grants.some(g => g.companyId === companyId && g.scopes.includes('tasks'));
}
