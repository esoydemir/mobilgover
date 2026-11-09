export type Env = { mode: 'demo' | 'pilot'; exampleRulesAllowed: boolean; mailTransport: string; mailProductionReady?: boolean; demoLoginDomain?: string };

export type Me = {
  userId: string; email: string | null; displayName: string; mfaEnabled: boolean; mfaSatisfied: boolean;
  platformRoles: string[];
  memberships: { companyId: string; siteId: string | null; role: 'owner' | 'hq_manager' | 'site_manager' | 'staff' }[];
  grants: { companyId: string; kind: string; scopes: string[] }[];
};

export type Company = {
  id: string; name: string; is_demo: boolean;
  sites: { id: string; name: string; timezone: string }[];
  roles: { role: Me['memberships'][number]['role']; siteId: string | null }[];
  grants?: { kind: string; scopes: string[] }[];
};

export type TaskRow = {
  id: string; site_id: string; status: 'open' | 'done' | 'missed' | 'cancelled'; outcome: 'conforming' | 'nonconforming' | null;
  due_at: string; period_key: string; review_flag: string | null; title: string; severity: 'minor' | 'major' | 'critical'; equipment_name: string | null;
  assignee_id: string | null; assignee_name: string | null;
};

export type Requirement =
  | { kind: 'measurement'; quantity: string; unit: string }
  | { kind: 'photo' | 'document'; min: number }
  | { kind: 'checklist'; items: { id: string; label: string; critical: boolean }[] }
  | { kind: 'note'; requiredWhen: 'always' | 'nonconforming' }
  | { kind: 'approval'; role: string }
  | { kind: 'device_record'; quantity: string };

export type TaskDetail = {
  relatedTraining?: { id: string; title: string; summary: string; is_example: boolean; minutes: number | null }[];
  relatedDocuments?: { id: string; title: string; purpose: string; kind: string }[];
  id: string; status: TaskRow['status']; outcome: TaskRow['outcome']; dueAt: string; reviewFlag: string | null;
  title: string; instructions: string; severity: TaskRow['severity'];
  equipment: { id: string; name: string; type: string } | null;
  rule: { version: number; kind: string; isExample: boolean };
  obligationId: string; requirements: Requirement[];
  limits: { quantity: string; equipmentType: string; unit: string; min: number | null; max: number | null; basis: string; note?: string }[];
  emergencyInstruction: string | null;
  progress: { complete: boolean; missing: string[]; pending: string[]; nonconforming: string[] };
  measurements: { id: string; value: number; unit: string; within_limit: boolean; measured_at: string; recorded_at: string; calibration_status: string }[];
  evidence: { id: string; kind: string; status: string; body: any; created_at: string; rejection_reason: string | null }[];
  nonconformity: { id: string; status: string; risk_level: string; depth: string } | null;
  statusReason: string | null;
  assignee: { id: string; name: string | null } | null;
  seriesResponsible: { id: string; name: string } | null;
  canAssign: boolean;
};

export type Assignee = { id: string; display_name: string; role: 'owner' | 'hq_manager' | 'site_manager' | 'staff' };

export type Obligation = {
  id: string; siteId: string; rule: string; version: number; title: string; kind: string; isExample: boolean;
  decision: 'applies' | 'not_applicable' | 'needs_info' | 'needs_review'; reason: string; missingFacts: string[];
};

export type Indicators = {
  formulaVersion: string; status: 'critical_risk' | 'insufficient_data' | 'attention' | 'on_track';
  score: number | null; scoreCappedBy: string | null;
  components: {
    onTime: { value: number | null; numerator: number; denominator: number };
    conforming: { value: number | null; numerator: number; denominator: number };
    evidenceCoverage: { value: number | null; numerator: number; denominator: number };
    overdueTasks: number; openCriticalRisks: number; recurringNonconformities: number;
    unknowns: { needsInfo: number; needsReview: number };
  };
  disclaimer: string;
};
