/**
 * Permission matrix. Every server operation calls `can()`; the UI may hide
 * buttons, but it is never the thing that enforces access.
 */
export type CompanyRole = 'owner' | 'hq_manager' | 'site_manager' | 'staff';
export type GrantKind = 'expert' | 'service_provider' | 'platform_support';
export type PlatformRole = 'rule_author' | 'rule_reviewer' | 'platform_admin' | 'marketplace_reviewer';

export type Action =
  | 'profile.read' | 'profile.write' | 'profile.verify'
  | 'obligation.read' | 'obligation.override'
  | 'equipment.read' | 'equipment.write'
  | 'task.read' | 'task.execute' | 'task.generate' | 'task.assign'
  | 'ncr.read' | 'ncr.act' | 'ncr.verify_close'
  | 'indicators.read' | 'audit.export' | 'audit.verify'
  | 'members.manage' | 'service.request';

/** What each company role may do. `site` = only within the member's site when the membership is site-scoped. */
export const ROLE_MATRIX: Record<CompanyRole, Action[]> = {
  owner: ['profile.read', 'profile.write', 'obligation.read', 'obligation.override', 'equipment.read', 'equipment.write',
    'task.read', 'task.execute', 'task.generate', 'task.assign', 'ncr.read', 'ncr.act', 'ncr.verify_close', 'indicators.read', 'audit.export', 'audit.verify',
    'members.manage', 'service.request'],
  hq_manager: ['profile.read', 'profile.write', 'obligation.read', 'obligation.override', 'equipment.read', 'equipment.write',
    'task.read', 'task.execute', 'task.generate', 'task.assign', 'ncr.read', 'ncr.act', 'ncr.verify_close', 'indicators.read', 'audit.export', 'audit.verify',
    'members.manage', 'service.request'],
  site_manager: ['profile.read', 'obligation.read', 'equipment.read', 'equipment.write',
    'task.read', 'task.execute', 'task.generate', 'task.assign', 'ncr.read', 'ncr.act', 'ncr.verify_close', 'indicators.read', 'audit.export', 'service.request'],
  // Staff see and do their own assigned work, including emergency instructions; no scores, penalties or other people's data.
  staff: ['task.read', 'task.execute', 'ncr.read', 'ncr.act', 'equipment.read'],
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
  tasks: ['task.read'],
  nonconformities: ['ncr.read'],
  audit: ['audit.export', 'audit.verify'],
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
  grants: { companyId: string; kind: GrantKind; scopes: string[] }[];
};

export type Target = { companyId: string; siteId?: string | null; assigneeId?: string | null };

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
    if (g.scopes.some(s => GRANT_SCOPES[s]?.includes(action))) return { ok: true, via: 'grant', siteScope: null };
  }
  return { ok: false };
}

/** True when the principal only sees assigned tasks in this company (staff). */
export function onlyAssignedTasks(p: Principal, companyId: string): boolean {
  const roles = p.memberships.filter(m => m.companyId === companyId).map(m => m.role);
  return roles.length > 0 && roles.every(r => r === 'staff') && !p.grants.some(g => g.companyId === companyId && g.scopes.includes('tasks'));
}
